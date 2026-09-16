import { AIC, cx } from '../../ui/cx'

/**
 * The banner beside the page title.
 *
 * Every colour in it is `--color-primary`, at an opacity — never a literal
 * green. Inventory ships ten palettes and a dark mode, and a hand-written
 * #25b003 would be the one green rectangle on a company that chose the blue
 * theme. The artwork is inline SVG for the same reason it is not a PNG: it
 * inherits the accent, costs one request less than it would as an asset, and
 * stays sharp at any width.
 */
function BannerArt() {
  return (
    <svg
      viewBox="0 0 160 90"
      className="h-[4.5rem] w-36 shrink-0 text-primary"
      role="presentation"
      focusable="false"
      aria-hidden
    >
      {/* Soft ground waves. */}
      <path
        d="M0 74 Q 26 62 52 72 T 104 70 T 160 63"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.18"
      />
      <path
        d="M0 85 Q 30 73 58 83 T 112 81 T 160 74"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.1"
      />

      {/* The report itself — a sheet with a heading and a small chart. */}
      <rect x="10" y="8" width="54" height="66" rx="7" fill="currentColor" opacity="0.1" />
      <rect
        x="10.75"
        y="8.75"
        width="52.5"
        height="64.5"
        rx="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.22"
      />
      <rect x="20" y="18" width="30" height="3.2" rx="1.6" fill="currentColor" opacity="0.28" />
      <rect x="20" y="25" width="21" height="3.2" rx="1.6" fill="currentColor" opacity="0.2" />
      <rect x="20" y="52" width="6" height="10" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="30" y="45" width="6" height="17" rx="2" fill="currentColor" opacity="0.68" />
      <rect x="40" y="37" width="6" height="25" rx="2" fill="currentColor" opacity="0.85" />

      {/* A share of the whole. */}
      <circle cx="111" cy="29" r="15" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.15" />
      <circle
        cx="111"
        cy="29"
        r="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="58 37"
        transform="rotate(-90 111 29)"
        opacity="0.7"
      />

      {/* Sent onward — the decision. */}
      <path d="M129 61 L157 48 L148 75 L142 65 Z" fill="currentColor" opacity="0.45" />
      <path
        d="M129 61 L142 65 L157 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.75"
      />
    </svg>
  )
}

export function ReportsHero({ className }: { className?: string }) {
  return (
    <aside
      className={cx(
        AIC,
        'relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl',
        'border border-primary/10 px-5 py-4',
        className,
      )}
      style={{
        background:
          'radial-gradient(circle at 82% 26%, rgb(var(--color-primary) / 0.14), transparent 36%),' +
          'linear-gradient(120deg, rgb(var(--color-primary) / 0.04) 0%, rgb(var(--color-primary) / 0.13) 100%)',
      }}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-snug text-gray-900 sm:text-lg">
          From Data to <strong className="font-bold text-primary">Decisions</strong>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-600 sm:text-[13px]">
          Insightful inventory reports for a smarter tomorrow.
        </p>
      </div>
      <BannerArt />
    </aside>
  )
}

export default ReportsHero
