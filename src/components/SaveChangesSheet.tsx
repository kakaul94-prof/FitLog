import { useId } from 'react'
import { createPortal } from 'react-dom'
import { Save, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'

/** Bottom action sheet shown when leaving a page with unsaved edits:
 *  Save changes / Discard changes / Cancel (tap outside = Cancel). */
export function SaveChangesSheet({
  title,
  saving,
  error,
  onSave,
  onDiscard,
  onCancel,
}: {
  title: string
  saving: boolean
  error?: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="mx-auto w-full max-w-md p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div
            id={titleId}
            className="border-b border-border p-3 text-center text-xs text-muted-foreground"
          >
            {title}
          </div>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex w-full items-center gap-3 p-4 text-left active:bg-accent disabled:opacity-50"
          >
            <Save className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {saving ? 'Saving…' : 'Save changes'}
            </span>
          </button>
          {error && (
            <p className="px-4 pb-3 text-xs text-destructive">{error}</p>
          )}
          <button
            onClick={onDiscard}
            disabled={saving}
            className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span className="text-sm font-medium">Discard changes</span>
          </button>
        </Card>
        <button
          onClick={onCancel}
          className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}
