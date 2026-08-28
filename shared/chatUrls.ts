const URL_RE = /https?:\/\/[^\s<>"'\)\]\}]+/gi

export function cleanExtractedUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/g, '')
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return []
  const found = text.match(URL_RE) ?? []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of found) {
    const url = cleanExtractedUrl(raw)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function extractUrlsFromMessages(
  messages: Array<{ texto_crudo?: string | null }>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of messages) {
    for (const url of extractUrlsFromText(m.texto_crudo ?? '')) {
      if (seen.has(url)) continue
      seen.add(url)
      out.push(url)
    }
  }
  return out
}

export function mergeUrlLists(...lists: Array<string[] | string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    if (list == null) continue
    const items = Array.isArray(list)
      ? list
      : list.split(/\n+/).map((s) => s.trim())
    for (const item of items) {
      const url = item.trim()
      if (!url || seen.has(url)) continue
      seen.add(url)
      out.push(url)
    }
  }
  return out
}

export function composeChatLinks(
  messages: Array<{ texto_crudo?: string | null }>,
  saved?: string[] | string | null,
): string[] {
  return mergeUrlLists(saved, extractUrlsFromMessages(messages))
}

export function linksToTextarea(urls: string[]): string {
  return urls.join('\n')
}
