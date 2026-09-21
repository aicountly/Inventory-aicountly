/**
 * Item media and documents — the adapter, ahead of the capability.
 *
 * The Inventory API has no attachment endpoint today: there is no upload route, no file column on
 * `inv_items`, and no storage the app is allowed to write to (see server-php/app/Config/Routes.php,
 * which stops at `items/{id}/openings`). This module exists so the Edit Item workspace can ask one
 * honest question — "can this company attach files to an item?" — and render the answer, rather
 * than each card inventing its own placeholder.
 *
 * What it deliberately is NOT:
 *
 *  - not a second file store. Nothing is written to localStorage, IndexedDB or a data URL kept in
 *    form state. A "saved" image that lives only in one browser is worse than no image: it shows
 *    for the person who added it and for nobody else, and the first cleared cache loses it.
 *  - not a guess at a future URL. The endpoint below is `null`, not a plausible-looking path.
 *
 * On the day Inventory grows attachments, fill in `ENDPOINT` and implement `list` / `upload` /
 * `remove` against the existing `api` client (so auth, company scope and the error interceptor
 * come for free). Every caller already handles both states.
 */

export interface ItemMediaFile {
  id: string
  name: string
  /** MIME type as the server reports it. */
  contentType: string
  sizeBytes: number | null
  url: string
  /** The image shown in the preview card. At most one per item. */
  isPrimary: boolean
  uploadedAt: string | null
  uploadedBy: string | null
}

export interface MediaCapability {
  available: boolean
  /** Shown to the user when unavailable — plain language, no stack trace, no false promise. */
  reason: string
}

const ENDPOINT: string | null = null

const UNAVAILABLE: MediaCapability = {
  available: false,
  reason:
    'Attachments are not part of the Inventory API yet. Images, certificates and manuals will appear here once the file service is live — nothing is stored in this browser in the meantime.',
}

class MediaUnsupportedError extends Error {
  constructor() {
    super(UNAVAILABLE.reason)
    this.name = 'MediaUnsupportedError'
  }
}

export const itemMediaService = {
  capability(): MediaCapability {
    return ENDPOINT === null ? UNAVAILABLE : { available: true, reason: '' }
  },

  /** The files on an item. Resolves empty rather than throwing when the capability is absent. */
  async list(_itemId: number, _signal?: AbortSignal): Promise<ItemMediaFile[]> {
    return []
  },

  async upload(_itemId: number, _file: File): Promise<ItemMediaFile> {
    throw new MediaUnsupportedError()
  },

  async remove(_itemId: number, _fileId: string): Promise<void> {
    throw new MediaUnsupportedError()
  },

  async setPrimary(_itemId: number, _fileId: string): Promise<void> {
    throw new MediaUnsupportedError()
  },
}

export default itemMediaService
