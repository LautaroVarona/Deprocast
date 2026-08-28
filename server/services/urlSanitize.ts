const QUERY_ALLOW = new Set(['v', 't', 'list', 'page', 'id', 'p'])

export function sanitizePersistUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return trimmed.split('#')[0]?.split('?')[0] ?? ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `${url.protocol}//${url.hostname}${url.pathname}`
  }
  url.username = ''
  url.password = ''
  url.hash = ''
  const kept = new URLSearchParams()
  for (const [k, v] of url.searchParams) {
    if (QUERY_ALLOW.has(k.toLowerCase())) kept.set(k, v)
  }
  url.search = kept.toString() ? `?${kept.toString()}` : ''
  return url.toString()
}
