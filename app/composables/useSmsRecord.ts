/** Field descriptor for the chat record detail/edit dialog (`SmsRecordDialog`). */
export interface SmsRecordFieldOption {
  label: string
  value: string | number | null
}

export interface SmsRecordField {
  key: string
  label: string
  type?: 'text' | 'number' | 'select'
  /** Reject empty values when saving. */
  required?: boolean
  /** false = shown in the detail list but never sent in the edit payload. */
  editable?: boolean
  /** Mask the value in the detail view (last 4 characters remain visible). */
  mask?: boolean
  options?: SmsRecordFieldOption[]
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/** Detail-view formatting shared by the dialog and its tests (masking included). */
export function formatSmsRecordValue(field: SmsRecordField, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '—'
  const option = field.options?.find(item => String(item.value) === String(raw))
  const text = option ? option.label : String(raw)
  if (field.mask) return text.length > 2 ? `••••${text.slice(-2)}` : '••••'
  return text
}

/** Download selected rows as CSV (UTF-8 with BOM so Excel opens it correctly). */
export function exportSmsRowsCsv(
  filename: string,
  columns: Array<{ key: string, label: string }>,
  rows: Array<Record<string, unknown>>
): void {
  const header = columns.map(column => csvCell(column.label)).join(',')
  const body = rows.map(row => columns.map(column => csvCell(row[column.key])).join(','))
  const blob = new Blob([`\uFEFF${[header, ...body].join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
