import dns from 'node:dns/promises'
import net from 'node:net'

const IG_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
])

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number)
    const a = p[0] ?? 0
    const b = p[1] ?? 0
    if (a === 10 || a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (net.isIP(ip) === 6) {
    const n = ip.toLowerCase()
    if (n === '::1' || n.startsWith('fe80:') || n.startsWith('fc') || n.startsWith('fd')) {
      return true
    }
    if (n.startsWith('::ffff:')) {
      return isPrivateIp(n.slice(7))
    }
  }
  return false
}

export type SafeInstagramUrl =
  | { ok: true; href: string; hostname: string }
  | { ok: false; error: string }

export function parseInstagramUrl(raw: string): SafeInstagramUrl {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'URL de Instagram vacía' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: 'URL de Instagram inválida' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Solo se acepta https' }
  }
  const host = url.hostname.toLowerCase()
  if (!IG_HOSTS.has(host)) {
    return { ok: false, error: 'Host de Instagram no permitido' }
  }
  if (url.port && url.port !== '443') {
    return { ok: false, error: 'Puerto no permitido' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Credenciales en URL no permitidas' }
  }
  url.hash = ''
  return { ok: true, href: url.toString(), hostname: host }
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  let records: string[]
  try {
    records = (await dns.lookup(hostname, { all: true })).map((r) => r.address)
  } catch {
    throw new Error(`No se pudo resolver ${hostname}`)
  }
  if (records.length === 0) throw new Error(`Sin registros DNS para ${hostname}`)
  for (const ip of records) {
    if (isPrivateIp(ip)) {
      throw new Error('Destino DNS privado o loopback bloqueado')
    }
  }
}

export async function validateInstagramDownloadUrl(
  raw: string,
): Promise<SafeInstagramUrl> {
  const parsed = parseInstagramUrl(raw)
  if (!parsed.ok) return parsed
  try {
    await assertPublicHostname(parsed.hostname)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'DNS bloqueado',
    }
  }
  return parsed
}
