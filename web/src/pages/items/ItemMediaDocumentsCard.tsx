import { FileText, Image as ImageIcon, Paperclip, ShieldCheck, Upload } from 'lucide-react'
import { itemMediaService } from '../../services/itemMediaService'
import { AIC, cx } from '../../ui/cx'
import { ItemSectionCard } from './ItemSectionCard'
import type { ItemCardBaseProps } from './ItemSectionCard'

/**
 * Product images, certificates, manuals and attachments — the section, ahead of the capability.
 *
 * There is no attachment endpoint in the Inventory API (see itemMediaService.ts). Two things this
 * card deliberately does NOT do about that:
 *
 *  - it does not accept a file and keep it in the browser. A drop zone that "works" by holding a
 *    data URL in form state produces an image only its uploader can see, on only one machine,
 *    until the first cache clear. That is worse than no image, because it looks like it saved.
 *  - it does not hide. The section stays in the nav and on the page, says plainly what is missing
 *    and what will happen when the file service arrives, so nobody goes looking for a feature that
 *    was quietly removed.
 *
 * When `itemMediaService.capability()` starts reporting available, the placeholder below is
 * replaced by the real list and drop zone; nothing else on this page has to change.
 */
const PLANNED = [
  { icon: ImageIcon, label: 'Product images', hint: 'One marked as the primary, shown in the preview.' },
  { icon: ShieldCheck, label: 'Certificates', hint: 'Compliance and test certificates against the item.' },
  { icon: FileText, label: 'Manuals & specifications', hint: 'Documents a picker or a buyer needs at hand.' },
]

export function ItemMediaDocumentsCard({ registerSection }: Pick<ItemCardBaseProps, 'registerSection'>) {
  const capability = itemMediaService.capability()

  return (
    <ItemSectionCard
      id="media"
      title="Media & Documents"
      description="Images, attachments and supporting documents"
      icon={Paperclip}
      register={registerSection}
    >
      {capability.available ? null : (
        <div className={cx(AIC, 'rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center')}>
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-card">
            <Upload className="h-5 w-5 text-gray-400" aria-hidden />
          </span>
          <h4 className="text-sm font-semibold text-gray-900">File attachments are not available yet</h4>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-gray-500">{capability.reason}</p>

          <ul className="mx-auto mt-4 grid max-w-2xl grid-cols-1 gap-2 text-left sm:grid-cols-3">
            {PLANNED.map((row) => (
              <li key={row.label} className="rounded-lg border border-gray-200 bg-white p-3">
                <row.icon className="mb-1.5 h-4 w-4 text-gray-400" aria-hidden />
                <p className="text-xs font-semibold text-gray-900">{row.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{row.hint}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ItemSectionCard>
  )
}

export default ItemMediaDocumentsCard
