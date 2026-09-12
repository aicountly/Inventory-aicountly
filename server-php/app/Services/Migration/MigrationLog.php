<?php

namespace App\Services\Migration;

/**
 * Machine-readable migration logs: writable/migration/<run_id>/<stage>.jsonl plus a
 * summary JSON per stage. Every line is {"ts":..., "stage":..., "level":..., "event":..., ...}.
 */
class MigrationLog
{
    private string $dir;
    private string $stage;
    /** @var array<string, mixed> */
    private array $summary = [];
    private $fh;

    public function __construct(private string $runId, string $stage)
    {
        $this->stage = $stage;
        $this->dir = rtrim((string) (getenv('INVENTORY_MIGRATION_LOG_DIR') ?: WRITEPATH . 'migration'), '/') . '/' . $runId;
        if (!is_dir($this->dir)) {
            mkdir($this->dir, 0775, true);
        }
        $this->fh = fopen($this->dir . '/' . $stage . '.jsonl', 'ab');
    }

    public function dir(): string
    {
        return $this->dir;
    }

    /** @param array<string, mixed> $data */
    public function event(string $event, array $data = [], string $level = 'info'): void
    {
        $row = array_merge(['ts' => gmdate('c'), 'run_id' => $this->runId, 'stage' => $this->stage, 'level' => $level, 'event' => $event], $data);
        fwrite($this->fh, json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
        if ($level === 'error' || $level === 'warning' || getenv('INVENTORY_MIGRATION_VERBOSE') === '1') {
            fwrite(STDERR, '[' . strtoupper($level) . '] ' . $event . ' ' . json_encode($data, JSON_UNESCAPED_SLASHES) . "\n");
        }
    }

    public function set(string $key, mixed $value): void
    {
        $this->summary[$key] = $value;
    }

    /** @return array<string, mixed> */
    public function summary(): array
    {
        return $this->summary;
    }

    public function finish(string $status): string
    {
        $this->summary['status'] = $status;
        $this->summary['finished_at'] = gmdate('c');
        $path = $this->dir . '/' . $this->stage . '.summary.json';
        file_put_contents($path, json_encode($this->summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fclose($this->fh);

        return $path;
    }
}
