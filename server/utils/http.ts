/**
 * School module — request parsing helpers shared by the route handlers.
 */

export interface Pagination {
  page: number
  pageSize: number
  limit: number
  offset: number
}

/** Clamp `page` / `pageSize` so a hostile query string cannot ask for everything. */
export function pagination(query: Record<string, unknown>, defaultSize = 50, maxSize = 200): Pagination {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
  const requested = Number.parseInt(String(query.pageSize ?? defaultSize), 10) || defaultSize
  const pageSize = Math.min(Math.max(1, requested), maxSize)
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize }
}

/** A positive integer query param, or null. */
export function intParam(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** A finite number query param, or null. */
export function numberParam(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

/** `1` / `true` / `yes` → true. */
export function boolParam(value: unknown): boolean {
  const raw = String(value ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/** A trimmed string param, or null when empty. */
export function textParam(value: unknown, maxLength = 500): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  return raw.slice(0, maxLength)
}

/**
 * A `YYYY-MM-DD` date param, or null.
 *
 * Validated rather than merely trimmed: a date string reaches Postgres directly,
 * and "2024-02-31" would either error or silently roll over into March.
 */
export function dateParam(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  // Round-trip check catches 2024-02-31, which `new Date` happily accepts.
  return parsed.toISOString().slice(0, 10) === raw ? raw : null
}

/** Today as `YYYY-MM-DD` in UTC — the default date for a new attendance sheet. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Escape the wildcards in a user-supplied LIKE pattern. */
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`
}

/** `?tag=a&tag=b` and `?tag=a,b` both yield `['a', 'b']`. */
export function listParam(value: unknown, max = 50): string[] {
  const raw = value == null ? [] : Array.isArray(value) ? value : [value]
  return raw
    .flatMap(item => String(item).split(','))
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, max)
}

/** A list of positive integer ids from a query param, deduplicated. */
export function idListParam(value: unknown, max = 200): number[] {
  return [...new Set(listParam(value, max).map(Number).filter(id => Number.isInteger(id) && id > 0))]
}

/** A trimmed string from a request body, or null. */
export function bodyText(body: Record<string, unknown>, key: string, maxLength = 500): string | null {
  return textParam(body[key], maxLength)
}
