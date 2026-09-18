import { Children, cloneElement, isValidElement, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { FormField } from '../ui/shell/FormSectionCard'

/**
 * A labelled control whose label is actually attached to it.
 *
 * `ui/shell`'s `FormField` takes an `htmlFor`, and a caller that forgets it
 * renders a label pointing at nothing: the control has no accessible name, a
 * screen reader announces "edit text, blank", and clicking the label does not
 * focus the field. Twenty-odd fields across four drawers is twenty-odd chances
 * to forget, so the id is generated here and pushed into the control.
 *
 * A child that already carries an `id` keeps it — nothing is overwritten.
 */
export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const only = Children.only(children)
  const control =
    isValidElement(only) && (only.props as { id?: string }).id === undefined
      ? cloneElement(only as ReactElement<{ id?: string }>, { id })
      : only
  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={id} className={className}>
      {control}
    </FormField>
  )
}

export default Field
