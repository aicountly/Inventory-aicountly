import { Paperclip } from 'lucide-react'
import { FormSectionCard } from '../ui/shell/FormSectionCard'
import { AIReasonAssistant } from './AIReasonAssistant'
import { AttachmentUploader } from './AttachmentUploader'
import type { StagedAttachment } from './AttachmentUploader'

interface WriteOffAssistPanelProps {
  warehouseId: number | null
  attachments: StagedAttachment[]
  onAttachmentsChange: (files: StagedAttachment[]) => void
  onApplyReasonSuggestion: (suggestion: { reasonCode: string; remark: string | null }) => void
  disabled?: boolean
}

/** Write-off only: proof-of-loss attachments beside the reason-code assistant. Both are advisory client-side aids — see AttachmentUploader and AIReasonAssistant for what each degrades to without a backend. */
export function WriteOffAssistPanel({ warehouseId, attachments, onAttachmentsChange, onApplyReasonSuggestion, disabled }: WriteOffAssistPanelProps) {
  return (
    <FormSectionCard title="Proof & reason assist" description="Optional: attach evidence of the loss and get help picking a reason code." icon={Paperclip}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <AttachmentUploader value={attachments} onChange={onAttachmentsChange} disabled={disabled} />
        <AIReasonAssistant warehouseId={warehouseId} onApply={onApplyReasonSuggestion} disabled={disabled} />
      </div>
    </FormSectionCard>
  )
}

export default WriteOffAssistPanel
