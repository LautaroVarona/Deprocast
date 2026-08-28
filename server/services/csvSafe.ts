export function csvEscape(value: unknown): string {
  if (value == null) return ''
  let s = typeof value === 'string' ? value : JSON.stringify(value)
  s = s.replace(/^[\s\u0000-\u001f]+/, '')
  if (/^[=+\-@]/.test(s) || s.startsWith('\t') || s.startsWith('\r')) {
    s = `'${s}`
  }
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

export { csvEscape as escapeCsvCell }
