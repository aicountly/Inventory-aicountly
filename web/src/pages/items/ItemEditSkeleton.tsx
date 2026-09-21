import { Skeleton } from '../../ui/Skeleton'
import { AIC, cx } from '../../ui/cx'

/**
 * The workspace's shape while the item is on its way.
 *
 * Deliberately the same geometry as the real page — header, sticky strip, three form cards, the
 * aside column — so nothing moves when the data lands. The alternative the old screen used was the
 * word "Loading…" over an empty form, which both told the reader nothing and reflowed the entire
 * page a moment later.
 *
 * `aria-busy` with a polite live region: a screen reader hears "Loading item" once, instead of
 * nothing at all or a hundred shimmering boxes.
 */
export function ItemEditSkeleton() {
  return (
    <div className={cx(AIC, 'space-y-3')} aria-busy="true">
      <p className="sr-only" role="status">
        Loading item…
      </p>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Skeleton className="h-10 w-10" rounded="xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <Skeleton className="h-11 w-full" rounded="xl" />

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem] wide:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-card">
              <div className="mb-4 flex items-center gap-3 border-b border-gray-100 pb-3">
                <Skeleton className="h-9 w-9" rounded="xl" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-2.5 w-52" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: i === 0 ? 9 : 3 }).map((_, f) => (
                  <div key={f} className="space-y-1.5">
                    <Skeleton className="h-2.5 w-20" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-card">
            <Skeleton className="mb-3 h-36 w-full" rounded="xl" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-24" />
            <Skeleton className="mt-4 h-9 w-full" />
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-card">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-16 w-full" rounded="lg" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-4/6" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ItemEditSkeleton
