import { createPortal } from 'react-dom'
import { ArrowRightLeft, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Bottom-sheet menu shown on long-press: an optional "select" action plus
// Edit / Delete. Labels default to the diary "entry" wording but can be
// overridden (e.g. "Edit note" / "Delete note").
export function ActionSheet({
  title,
  onSelect,
  selectLabel = 'Select multiple',
  onMove,
  moveLabel = 'Move to meal',
  onEdit,
  editLabel = 'Edit entry',
  onDelete,
  deleteLabel = 'Delete entry',
  onClose,
}: {
  title: string
  onSelect?: () => void
  selectLabel?: string
  onMove?: () => void
  moveLabel?: string
  onEdit: () => void
  editLabel?: string
  onDelete: () => void
  deleteLabel?: string
  onClose: () => void
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div className="truncate border-b border-border p-3 text-center text-xs text-muted-foreground">
            {title}
          </div>
          {onSelect && (
            <button
              onClick={onSelect}
              className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
            >
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{selectLabel}</span>
            </button>
          )}
          {onMove && (
            <button
              onClick={onMove}
              className={cn(
                'flex w-full items-center gap-3 p-4 text-left active:bg-accent',
                onSelect && 'border-t border-border',
              )}
            >
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{moveLabel}</span>
            </button>
          )}
          <button
            onClick={onEdit}
            className={cn(
              'flex w-full items-center gap-3 p-4 text-left active:bg-accent',
              (onSelect || onMove) && 'border-t border-border',
            )}
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{editLabel}</span>
          </button>
          <button
            onClick={onDelete}
            className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent"
          >
            <Trash2 className="h-4 w-4" />
            <span className="text-sm font-medium">{deleteLabel}</span>
          </button>
        </Card>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}
