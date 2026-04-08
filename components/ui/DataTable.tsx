import { cn } from '@/lib/utils/cn'
import { ReactNode } from 'react'

export interface DataTableColumn<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  emptyMessage?: string
  className?: string
  /** Enable row selection checkboxes */
  selectable?: boolean
  /** Currently selected row IDs (controlled) */
  selectedIds?: Set<string>
  /** Callback when selection changes */
  onSelectionChange?: (ids: Set<string>) => void
  /** Function to extract a unique ID from each row. Defaults to row.id */
  getRowId?: (row: T) => string
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  emptyMessage = 'No data to display.',
  className,
  selectable = false,
  selectedIds,
  onSelectionChange,
  getRowId = (row) => row.id as string,
}: DataTableProps<T>) {
  const allIds = rows.map(getRowId)
  const allSelected = rows.length > 0 && selectedIds ? allIds.every((id) => selectedIds.has(id)) : false
  const someSelected = selectedIds ? allIds.some((id) => selectedIds.has(id)) : false

  function toggleAll() {
    if (!onSelectionChange) return
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(allIds))
    }
  }

  function toggleRow(id: string) {
    if (!onSelectionChange || !selectedIds) return
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }

  return (
    <div className={cn('w-full overflow-x-auto border border-gray-200 rounded-lg', className)}>
      <table className="w-full text-sm">
        <thead className="bg-eq-ice">
          <tr>
            {selectable && (
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded border-gray-300 text-eq-sky focus:ring-eq-sky cursor-pointer"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'text-left px-4 py-2 text-xs font-bold text-eq-deep uppercase tracking-wide',
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="px-4 py-6 text-center text-eq-grey text-sm"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const rowId = getRowId(row)
              const isSelected = selectable && selectedIds?.has(rowId)
              return (
                <tr
                  key={rowId || i}
                  className={cn(
                    'border-t border-gray-100 hover:bg-gray-50',
                    isSelected && 'bg-eq-ice/40'
                  )}
                >
                  {selectable && (
                    <td className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={!!isSelected}
                        onChange={() => toggleRow(rowId)}
                        className="w-4 h-4 rounded border-gray-300 text-eq-sky focus:ring-eq-sky cursor-pointer"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn('px-4 py-3 text-eq-ink', col.className)}
                    >
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
