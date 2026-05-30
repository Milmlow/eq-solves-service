'use client'

/**
 * Thin re-export — canonical implementation lives in @eq-solutions/ui (Table).
 *
 * Call sites import DataTable + DataTableColumn from this module and continue
 * to work unchanged. The canonical Table is a superset: it adds defaultSort,
 * rowStyle, per-column align and width — all optional, all backwards-compatible.
 *
 * Name aliases:
 *   DataTable       → Table        (component)
 *   DataTableColumn → TableColumn  (type)
 *   DataTableProps  → TableProps   (type, for consumers who typed the props)
 */
export { Table as DataTable } from '@eq-solutions/ui'
export type { TableColumn as DataTableColumn, TableProps as DataTableProps } from '@eq-solutions/ui'
