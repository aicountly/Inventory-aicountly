import { useState } from 'react'
import { Layers3, Plus, Tag, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { FormGrid } from '../../ui/shell/FormSectionCard'
import { AIC, cx } from '../../ui/cx'
import { ItemSectionCard } from './ItemSectionCard'
import type { ItemCardBaseProps } from './ItemSectionCard'
import { FieldNote, TextAreaField, TextField, fieldId } from './ItemWorkspaceKit'
import type { ItemAttributesDraft } from './itemAttributes'

/**
 * Everything the item master keeps that is not a column: description, notes, provenance, tags and
 * whatever custom keys this company has put on its items.
 *
 * It all lives in `attributes_json`, which the API has round-tripped since the first migration and
 * which nothing in the UI ever showed. See itemAttributes.ts for why that is the right home and
 * for the rule that keeps a key this screen does not model from being lost on save.
 */
export function ItemAdditionalCard({ form, set, readOnly, registerSection }: ItemCardBaseProps) {
  const attrs = form.attributes
  const [tagDraft, setTagDraft] = useState('')

  const patch = (next: Partial<ItemAttributesDraft>) => set('attributes', { ...attrs, ...next })

  const addTag = () => {
    const tag = tagDraft.trim()
    if (!tag) return
    if (!attrs.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) patch({ tags: [...attrs.tags, tag] })
    setTagDraft('')
  }

  const tagsId = fieldId('tags')
  const preservedCount = Object.keys(attrs.preserved).length

  return (
    <ItemSectionCard
      id="additional"
      title="Additional"
      description="Description, provenance, tags and any custom fields on this item"
      icon={Layers3}
      register={registerSection}
    >
      <FormGrid cols={2} gap="md">
        <TextAreaField
          name="description"
          label="Description"
          value={attrs.description}
          rows={3}
          maxLength={2000}
          disabled={readOnly}
          placeholder="What this item is, in the words a picker or a buyer would use."
          hint="Shown on the item preview."
          onChange={(v) => patch({ description: v })}
        />
        <TextAreaField
          name="notes"
          label="Internal notes"
          value={attrs.notes}
          rows={3}
          maxLength={2000}
          disabled={readOnly}
          placeholder="Handling, storage, anything the team should know."
          onChange={(v) => patch({ notes: v })}
        />
      </FormGrid>

      <FormGrid cols={4} gap="md" className="mt-3">
        <TextField
          name="manufacturer"
          label="Manufacturer"
          value={attrs.manufacturer}
          maxLength={120}
          disabled={readOnly}
          onChange={(v) => patch({ manufacturer: v })}
        />
        <TextField
          name="country_of_origin"
          label="Country of origin"
          value={attrs.country_of_origin}
          maxLength={80}
          disabled={readOnly}
          onChange={(v) => patch({ country_of_origin: v })}
        />
        <TextField
          name="weight"
          label="Weight"
          value={attrs.weight}
          maxLength={40}
          disabled={readOnly}
          placeholder="e.g. 8 g"
          onChange={(v) => patch({ weight: v })}
        />
        <TextField
          name="dimensions"
          label="Dimensions"
          value={attrs.dimensions}
          maxLength={80}
          disabled={readOnly}
          placeholder="e.g. 140 × 10 × 10 mm"
          onChange={(v) => patch({ dimensions: v })}
        />
      </FormGrid>

      <div className={cx(AIC, 'mt-4')}>
        <label htmlFor={tagsId} className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Tags
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {attrs.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700"
            >
              <Tag className="h-3 w-3" aria-hidden />
              {tag}
              {!readOnly ? (
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => patch({ tags: attrs.tags.filter((t) => t !== tag) })}
                  className="rounded-sm text-sky-600 transition-colors hover:text-sky-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
          {attrs.tags.length === 0 ? <span className="text-[11px] text-gray-400">No tags yet.</span> : null}
        </div>
        {!readOnly ? (
          <div className="mt-2 flex max-w-sm items-center gap-2">
            <Input
              id={tagsId}
              size="md"
              value={tagDraft}
              placeholder="Add a tag and press Enter"
              maxLength={40}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds a tag; it must not reach the form and submit it.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                }
              }}
            />
            <Button variant="secondary" size="sm" icon={Plus} onClick={addTag} disabled={!tagDraft.trim()}>
              Add
            </Button>
          </div>
        ) : null}
      </div>

      {attrs.custom.length > 0 || !readOnly ? (
        <div className="mt-4 rounded-xl border border-gray-200 p-3">
          <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-gray-900">Custom fields</h4>
            {!readOnly ? (
              <Button
                variant="ghost"
                size="xs"
                icon={Plus}
                onClick={() => patch({ custom: [...attrs.custom, { key: '', value: '' }] })}
              >
                Add field
              </Button>
            ) : null}
          </header>
          {attrs.custom.length === 0 ? (
            <p className="text-[11px] text-gray-500">
              Anything else this company keeps on an item. Added here, it travels with the item through the API.
            </p>
          ) : (
            <div className="space-y-2">
              {attrs.custom.map((row, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    size="md"
                    aria-label={`Custom field ${index + 1} name`}
                    className="w-full sm:w-52"
                    placeholder="field_name"
                    value={row.key}
                    maxLength={60}
                    disabled={readOnly}
                    onChange={(e) =>
                      patch({ custom: attrs.custom.map((c, i) => (i === index ? { ...c, key: e.target.value } : c)) })
                    }
                  />
                  <Input
                    size="md"
                    aria-label={`Custom field ${index + 1} value`}
                    className="min-w-0 flex-1"
                    placeholder="Value"
                    value={row.value}
                    maxLength={500}
                    disabled={readOnly}
                    onChange={(e) =>
                      patch({ custom: attrs.custom.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)) })
                    }
                  />
                  {!readOnly ? (
                    <button
                      type="button"
                      aria-label={`Remove custom field ${index + 1}`}
                      onClick={() => patch({ custom: attrs.custom.filter((_, i) => i !== index) })}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {preservedCount > 0 ? (
        <FieldNote tone="info" className="mt-3">
          {preservedCount === 1 ? 'One structured attribute' : `${preservedCount} structured attributes`} on this item
          ({Object.keys(attrs.preserved).join(', ')}) {preservedCount === 1 ? 'is' : 'are'} held as nested data. It is
          kept exactly as it is and saved back untouched — a text box would not be an honest editor for it.
        </FieldNote>
      ) : null}
    </ItemSectionCard>
  )
}

export default ItemAdditionalCard
