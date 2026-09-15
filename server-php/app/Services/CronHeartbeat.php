<?php

namespace App\Services;

/**
 * Reports a scheduled run to Console's Cron Job Monitor.
 *
 * WHY THIS EXISTS
 * ---------------
 * On shared hosting a cron that silently stops running leaves no trace at all: no error, no log
 * line, nothing anybody notices until the work it was doing has been undone for a month. Console
 * is opened every day, so Console is where that has to become visible.
 *
 * The job reports ITSELF. Console does not read this product's logs: log scraping depends on
 * paths, extensions and rotation, and it fails silently the moment any of those change — three
 * rounds of diagnosis were once lost looking for log-2026-09-15.php when the file on disk was
 * log-2026-09-15.log. A monitor that can be defeated by a filename is not a monitor. Heartbeats
 * also work for a job that writes no log at all.
 *
 * WHAT IT SENDS
 * -------------
 *   begin()                  POST outcome=started   with started_at and a fresh run_id
 *   success($counts, $msg)   POST outcome=ok        with the SAME run_id and finished_at
 *   failure($msg, $counts)   POST outcome=error     with the SAME run_id and finished_at
 *
 * The run_id is generated once, at begin(), and reused for the finish. That pairing is what lets
 * Console tell "ran and finished" from "started and died half way" (STUCK) — a run with a start
 * and no finish is a different fault from a run that never started at all (OVERDUE), and the two
 * need different responses.
 *
 * WHAT IT MUST NEVER DO
 * ---------------------
 * Break the job. A monitoring call that takes down the work it monitors is the worst possible
 * outcome: the job stops doing its work AND the monitor still goes green-to-red for the wrong
 * reason. So every public method here catches \Throwable — Errors included, because a host
 * without ext-curl raises an Error, not an Exception — logs at warning and returns. A network
 * timeout, a 500 from Console, a DNS failure, a body that is not JSON: all are swallowed.
 *
 * If Console cannot be reached at all, no heartbeat arrives and the monitor reads OVERDUE. That
 * is not a gap in this design, it is the design: an emitter that cannot report is indistinguishable
 * from a job that did not run, and OVERDUE is the honest reading of both.
 *
 * UNCONFIGURED MEANS INERT
 * ------------------------
 * With no service key in .env this class does NOTHING: no HTTP, no log line, not even a run id.
 * Two reasons, and both matter. An environment that was never meant to report must not write a
 * warning on every single run — noise like that is how people learn to ignore the log. And a
 * developer's laptop must never file a heartbeat into production's monitor, which would hold a
 * monitor green while the production cron was dead.
 *
 * ADOPTING IT
 * -----------
 * A spark command wires it in one line:
 *
 *     return CronHeartbeat::reportRun('inventory.orphan_sweep', fn (CronHeartbeat $b) => $this->sweep($b));
 *
 * or explicitly, when the command wants to choose its own counts and message:
 *
 *     $beat = CronHeartbeat::for('inventory.orphan_sweep')->begin();
 *     ...
 *     $beat->success(['scanned' => 412, 'settled' => 3]);   // or $beat->failure($e->getMessage());
 *
 * Under reportRun() the work may call success()/failure() itself AND the exit code still decides:
 * the finish is held until the run really ends, so a sweep that publishes its counts and then
 * returns EXIT_ERROR is reported as an error carrying those counts, not as the 'ok' it filed on
 * its way past. Driving begin()/success() by hand, as above, sends each report immediately.
 *
 * The monitor code must already be REGISTERED in Console (a row in cron_monitors, added by a
 * Console migration, carrying the expected interval). Console rejects an unknown code rather than
 * creating one, because a monitor that appears on first report can never tell anyone about a job
 * that has never run once — which is the exact blind spot this feature closes.
 */
class CronHeartbeat
{
    /**
     * Total wall-clock budget for one heartbeat POST, in seconds.
     *
     * Five. This runs inside a job that has real work to do, and it runs twice (a start and a
     * finish), so the worst case a wedged Console can add to any run is ten seconds. Long enough
     * that an ordinary POST to a busy shared host still lands; short enough that a Console which
     * is hanging rather than refusing cannot turn a two-minute sweep into a stuck process. The
     * timeout is asserted in CronHeartbeatTest, so raising it is a deliberate act.
     */
    public const TIMEOUT_SECONDS = 5;

    /** Of that budget, the most that may be spent on DNS + TCP + TLS before giving up. */
    public const CONNECT_TIMEOUT_SECONDS = 2;

    /** Console route (Config/Routes.php 'portal/cron-heartbeat'), relative to the API root. */
    public const PATH = 'portal/cron-heartbeat';

    /** The header Console's CronMonitorKey reads the service key from. */
    public const KEY_HEADER = 'X-Console-Cron-Key';

    /** Console's schema caps run_id at 120 characters; overrun it and the row is rejected. */
    public const MAX_RUN_ID_CHARS = 120;

    /** Console trims a longer message anyway; trimming here keeps the request small. */
    public const MAX_MESSAGE_CHARS = 2000;

    /** Sanity cap on the counts object, so a job that hands over a huge array cannot bloat a POST. */
    private const MAX_COUNT_KEYS = 50;

    /** Only Console. There is one, at console.aicountly.org; CONSOLE_API_BASE overrides for a rehearsal. */
    private const DEFAULT_BASE = 'https://console.aicountly.org/api';

    /** Registered monitor code, e.g. 'inventory.orphan_sweep'. */
    private string $monitor;

    /** Null until begin() (or a finish without one) generates it; stays null when unconfigured. */
    private ?string $runId = null;

    /** The emitter's clock at begin(), sent as started_at so Console can show a duration. */
    private ?string $startedAt = null;

    /** A finish has already been reported; further calls are no-ops rather than a second run. */
    private bool $finished = false;

    /**
     * Set only by reportRun(): a finish the work reports itself is HELD until the run's exit code
     * is known, so the two can never disagree in Console's favour. Outside reportRun a finish is
     * sent the moment it is reported, which is what a command driving begin()/success() by hand
     * expects.
     */
    private bool $deferred = false;

    /** @var array{outcome:string, message:string, counts:array<string, scalar>}|null the held finish */
    private ?array $pending = null;

    public function __construct(string $monitor)
    {
        $this->monitor = trim($monitor);
    }

    /** Reads better at a call site than `new CronHeartbeat(...)`. */
    public static function for(string $monitor): static
    {
        return new static($monitor);
    }

    /**
     * Run a spark command body under a heartbeat and hand back its exit code unchanged.
     *
     * The one-line adoption path. $work receives this heartbeat, so it may call success() or
     * failure() itself to supply real counts — and THE EXIT CODE STILL HAS THE LAST WORD.
     *
     * That is why a finish reported from inside $work is held rather than sent. A sweep that
     * publishes its counts with $b->success(['scanned' => 412]) and then hits an unsettleable
     * company and returns EXIT_ERROR has failed, and Console used to be told only the 'ok': the
     * first finish won, the later failure() was a no-op, and the monitor read green on every
     * single cycle of a job that was failing on every single cycle. Now exactly one finish is
     * sent, once the run's real verdict is known, carrying the counts the work reported.
     *
     * The reverse is protected too: a failure the work reported itself is never erased by a
     * zero exit code.
     *
     * An exception from $work is reported as a failure and then RE-THROWN. The job's own error
     * handling is the job's; this only makes sure the monitor hears about it first.
     *
     * @param callable(self):int $work
     */
    public static function reportRun(string $monitor, callable $work): int
    {
        $beat = static::for($monitor);
        $beat->deferred = true;
        $beat->begin();

        try {
            $code = $work($beat);
        } catch (\Throwable $e) {
            $beat->settle(true, get_class($e) . ': ' . $e->getMessage());

            throw $e;
        }

        $beat->settle($code !== EXIT_SUCCESS, 'Exited with code ' . $code);

        return $code;
    }

    /**
     * Report that the run has started, and fix the run id the finish will reuse.
     *
     * Returns $this so it chains onto a constructor. Never throws.
     */
    public function begin(): static
    {
        try {
            if ($this->monitor === '' || ! self::isConfigured()) {
                return $this;
            }
            $this->runId    = $this->newRunId();
            $this->startedAt = $this->now();

            $this->send([
                'outcome'    => 'started',
                'started_at' => $this->startedAt,
            ]);
        } catch (\Throwable $e) {
            $this->warn($e);
        }

        return $this;
    }

    /**
     * Report that the run finished and did its work.
     *
     * @param array<string, scalar> $counts the job's own tally — the number a person reads to
     *                                      decide whether "it ran" also means "it worked"
     */
    public function success(array $counts = [], string $message = ''): void
    {
        $this->finish('ok', $message, $counts);
    }

    /**
     * Report that the run finished and did NOT work.
     *
     * A finish carrying an error is a different state from no finish at all: the cron is alive,
     * the job is not doing its job, and Console reads it FAILING rather than OVERDUE or STUCK.
     *
     * @param array<string, scalar> $counts whatever it managed before it failed, if anything
     */
    public function failure(string $message, array $counts = []): void
    {
        $this->finish('error', $message !== '' ? $message : 'Run failed without a message.', $counts);
    }

    /** The id pairing this run's start with its finish; null when nothing is being reported. */
    public function runId(): ?string
    {
        return $this->runId;
    }

    /** True once success() or failure() has been called, whether or not the POST landed. */
    public function isFinished(): bool
    {
        return $this->finished;
    }

    /**
     * Is there a service key for Console in this environment?
     *
     * CONSOLE_CRON_MONITOR_KEY is the dedicated one. CONSOLE_SERVICE_KEY is accepted as a fallback
     * because products are already configured with it, so a new monitor is not OVERDUE on day one
     * purely because a fresh secret had not been distributed yet — Console accepts either.
     *
     * A key still holding its .env.example placeholder counts as unset: a literal "CHANGE_ME..."
     * would be rejected by Console on every run and log a warning every time, which reads like a
     * broken monitor rather than an unconfigured one.
     */
    public static function isConfigured(): bool
    {
        return self::serviceKey() !== '';
    }

    /** @return string '' when unset or still a placeholder */
    public static function serviceKey(): string
    {
        foreach (['CONSOLE_CRON_MONITOR_KEY', 'CONSOLE_SERVICE_KEY'] as $var) {
            $value = getenv($var);
            if ($value === false) {
                continue;
            }
            $value = trim((string) $value);
            if ($value !== '' && ! str_starts_with($value, 'CHANGE_ME')) {
                return $value;
            }
        }

        return '';
    }

    /**
     * Console's API root.
     *
     * CONSOLE_API_BASE may be given as the API root (https://console.aicountly.org/api) or as a
     * bare origin; a local rehearsal origin serves the API at its root. Same rule as
     * BooksApiClient::apiRoot(), so the two env vars behave the same way.
     */
    public static function apiRoot(): string
    {
        $base = getenv('CONSOLE_API_BASE');
        $base = $base === false ? '' : rtrim(trim((string) $base), '/');
        if ($base === '') {
            return self::DEFAULT_BASE;
        }
        if (preg_match('#/api$#', $base) === 1
            || preg_match('#^https?://(127\.0\.0\.1|localhost)(:\d+)?$#', $base) === 1) {
            return $base;
        }

        return $base . '/api';
    }

    public static function endpoint(): string
    {
        return self::apiRoot() . '/' . self::PATH;
    }

    /* ===================================================================== */
    /* Internals                                                             */
    /* ===================================================================== */

    /**
     * @param array<string, scalar> $counts
     */
    private function finish(string $outcome, string $message, array $counts): void
    {
        try {
            if ($this->finished || $this->monitor === '' || ! self::isConfigured()) {
                // Marked finished even when unconfigured, so a job that calls success() twice
                // behaves identically whether or not a key happens to be present.
                $this->finished = true;

                return;
            }

            // Under reportRun(): record what the work says it did, and let the exit code decide
            // what is actually sent. Marked finished as well, so a second call from the work is
            // the same no-op it has always been.
            if ($this->deferred) {
                $this->finished = true;
                $this->pending  = [
                    'outcome' => $outcome,
                    'message' => $message,
                    'counts'  => $counts,
                ];

                return;
            }

            $this->finished = true;

            // A finish with no begin() still reports: a record of one completed run is worth more
            // than silence, and Console's (monitor, run_id) upsert simply creates the row.
            $this->runId ??= $this->newRunId();

            $this->send([
                'outcome'     => $outcome,
                'started_at'  => $this->startedAt,
                'finished_at' => $this->now(),
                'message'     => $this->trimMessage($message),
                'counts'      => $this->sanitiseCounts($counts),
            ]);
        } catch (\Throwable $e) {
            $this->finished = true;
            $this->warn($e);
        }
    }

    /**
     * Send the one finish a reportRun() gets, now that the exit code is known.
     *
     * $failed is the verdict from outside the work — a non-zero exit code, or an exception. It
     * can only ever make the report WORSE: a run the work called a success and then exited 1 on
     * is an error, and a failure the work reported itself survives a zero exit code. Whatever
     * counts the work published are kept either way; they are what it actually did.
     *
     * Never throws: called from reportRun's catch block, where an exception here would replace
     * the job's own error with a monitoring error.
     */
    private function settle(bool $failed, string $verdict): void
    {
        try {
            $pending = $this->pending;

            $this->pending  = null;
            $this->deferred = false;
            $this->finished = false;

            $counts   = $pending['counts'] ?? [];
            $reported = (string) ($pending['message'] ?? '');
            $outcome  = $failed ? 'error' : (string) ($pending['outcome'] ?? 'ok');

            if (! $failed) {
                $this->finish($outcome, $reported, $counts);

                return;
            }

            $message = $verdict;
            if ($pending !== null) {
                $message .= $pending['outcome'] === 'ok'
                    ? ' — the run reported success first' . ($reported !== '' ? ': ' . $reported : '')
                    : ($reported !== '' ? ': ' . $reported : '');
            }

            $this->finish('error', $message, $counts);
        } catch (\Throwable $e) {
            $this->finished = true;
            $this->warn($e);
        }
    }

    /**
     * Build and POST one heartbeat. Everything below here may throw; every caller catches.
     *
     * @param array<string, mixed> $fields
     */
    private function send(array $fields): void
    {
        $payload = array_filter(
            $fields + [
                'monitor' => $this->monitor,
                'run_id'  => $this->runId,
                'sent_at' => $this->now(),
            ],
            static fn ($v): bool => $v !== null && $v !== '' && $v !== [],
        );

        // counts travel as a JSON OBJECT, never an array. A tally whose keys happen to be
        // 0,1,2 encodes as [1,2,3] otherwise, and Console refuses a counts array rather than
        // storing something it would have to display as empty.
        if (isset($payload['counts']) && is_array($payload['counts'])) {
            $payload['counts'] = (object) $payload['counts'];
        }

        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($body === false) {
            // Almost always a value that is not valid UTF-8. Give up the parts, never the run:
            // counts first, then the message — and the message is the diagnosis a FAILING run
            // carries, so it is replaced with a note rather than simply vanishing. A run that
            // reported nothing reads STUCK ("started and died half way") instead of FAILING
            // ("ran and did not work"), which sends somebody looking for a hung process that
            // does not exist.
            unset($payload['counts']);
            $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        if ($body === false && isset($payload['message'])) {
            $payload['message'] = self::asUtf8((string) $payload['message']);
            $body               = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        if ($body === false) {
            $payload['message'] = 'Message could not be encoded as UTF-8 and was dropped; '
                . 'the outcome of this run is unchanged.';
            $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        if (! is_string($body)) {
            throw new \RuntimeException('Heartbeat payload could not be encoded as JSON.');
        }

        $result = $this->post(self::endpoint(), $body);

        $status = (int) ($result['status'] ?? 0);
        if ($status < 200 || $status >= 300) {
            throw new \RuntimeException(sprintf(
                'Console answered %s for %s: %s',
                $status === 0 ? 'nothing' : (string) $status,
                self::endpoint(),
                ((string) ($result['error'] ?? '')) !== ''
                    ? (string) $result['error']
                    : substr((string) ($result['body'] ?? ''), 0, 300),
            ));
        }
    }

    /**
     * The transport. Overridden in tests to stand in for a Console that is slow, broken or absent.
     *
     * curl directly rather than service('curlrequest'): this runs under spark with no HTTP request
     * in flight, and BooksApiClient — the other outbound service client here — does the same.
     *
     * @return array{status:int, body:string, error:string}
     */
    protected function post(string $url, string $body): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, $this->curlOptions($body));
        $raw    = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error  = (string) curl_error($ch);
        curl_close($ch);

        return [
            'status' => $status,
            'body'   => is_string($raw) ? $raw : '',
            'error'  => $error,
        ];
    }

    /**
     * The curl options one heartbeat POST is sent with.
     *
     * Split out from post() so the timeouts are something a test can read back and assert. curl
     * options are write-only once set, and a timeout nothing checks is a timeout that quietly
     * becomes 0 (meaning "wait forever") the next time somebody edits this method.
     *
     * @return array<int, mixed>
     */
    protected function curlOptions(string $body): array
    {
        return [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => 'POST',
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json',
                'Content-Type: application/json',
                self::KEY_HEADER . ': ' . self::serviceKey(),
                'X-Source-App: inventory',
            ],
            CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT_SECONDS,
            CURLOPT_TIMEOUT        => self::TIMEOUT_SECONDS,
        ];
    }

    /**
     * Log a swallowed heartbeat failure.
     *
     * Warning, not error: nothing is broken in this product when Console cannot be reached, and
     * the monitor will read OVERDUE on its own, which is the signal that matters. Logging the
     * whole thing inside its own try/catch because a logger that is itself misconfigured must not
     * be the thing that finally breaks the job.
     */
    protected function warn(\Throwable $e): void
    {
        try {
            if (function_exists('log_message')) {
                log_message('warning', 'Cron heartbeat for {monitor} not delivered: {msg}', [
                    'monitor' => $this->monitor !== '' ? $this->monitor : '(no monitor code)',
                    'msg'     => $e->getMessage(),
                ]);
            }
        } catch (\Throwable) {
            // Nothing left to do. Never rethrow from here.
        }
    }

    /**
     * A value unique to this execution: UTC timestamp for readability, random suffix for
     * uniqueness when two runs of the same job start in the same second.
     */
    private function newRunId(): string
    {
        $id = gmdate('Ymd\THis\Z') . '-' . bin2hex(random_bytes(8));

        return strlen($id) > self::MAX_RUN_ID_CHARS ? substr($id, 0, self::MAX_RUN_ID_CHARS) : $id;
    }

    /** ISO-8601 with an offset, so Console reads the emitter's clock unambiguously. */
    private function now(): string
    {
        return date(DATE_ATOM);
    }

    private function trimMessage(string $message): string
    {
        // Sanitised before it is trimmed. A failure message is the report most likely to carry
        // raw driver text — 'SQLSTATE[22021]: bad byte ... in column' quoting a latin1 customer
        // name — and one invalid byte in it used to make json_encode fail twice and drop the
        // entire finish. The words are worth keeping; the run is worth far more.
        $message = trim(self::asUtf8($message));
        if ($message === '') {
            return '';
        }

        return mb_strlen($message) > self::MAX_MESSAGE_CHARS
            ? mb_substr($message, 0, self::MAX_MESSAGE_CHARS - 3) . '...'
            : $message;
    }

    /** Whatever arrived, as valid UTF-8, with anything that is not replaced rather than dropped. */
    private static function asUtf8(string $value): string
    {
        if ($value === '' || preg_match('//u', $value) === 1) {
            return $value;
        }

        $clean = @iconv('UTF-8', 'UTF-8//IGNORE', $value);
        if (is_string($clean) && preg_match('//u', $clean) === 1) {
            return $clean;
        }

        if (function_exists('mb_convert_encoding')) {
            $clean = @mb_convert_encoding($value, 'UTF-8', 'UTF-8');
            if (is_string($clean) && preg_match('//u', $clean) === 1) {
                return $clean;
            }
        }

        return (string) preg_replace('/[\x80-\xFF]/', '?', $value);
    }

    /**
     * Counts are a flat object of scalars. Anything else is dropped rather than sent: a nested
     * structure is not what the console screen renders, and an unbounded one is a way to make a
     * heartbeat POST large enough to be slow.
     *
     * @param  array<string, mixed>  $counts
     * @return array<string, scalar>
     */
    private function sanitiseCounts(array $counts): array
    {
        $clean = [];
        foreach ($counts as $key => $value) {
            if (count($clean) >= self::MAX_COUNT_KEYS) {
                break;
            }
            $key = trim((string) $key);
            if ($key === '' || ! is_scalar($value)) {
                continue;
            }
            $clean[$key] = is_bool($value) ? (int) $value : $value;
        }

        return $clean;
    }
}
