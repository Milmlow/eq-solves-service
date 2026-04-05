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
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  emptyMessage = 'No data to display.',
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn('w-full overflow-x-auto border border-gray-200 rounded-lg', className)}>
      <table className="w-full text-sm">
        <thead className="bg-eq-ice">
          <tr>
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
                colSpan={columns.length}
                className="px-4 py-6 text-center text-eq-grey text-sm"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn('px-4 py-3 text-eq-ink', col.className)}
                  >
                    {col.render ? col.render(row) : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
