/**
 * Codec L72 v1 — retículo de 72 celdas (8 dominios × 9 oficios).
 * Permutación dentro de cada bloque de 9. HMAC-SHA256 como sello.
 */
import {
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto'

export const L72_CODEC = 'l72.v1'
export const L72_CELLS = 72
export const L72_BLOCK = 9
export const L72_DOMAINS = 8
export const L72_BYTES = L72_CELLS * 2

export type QuantomoStage = 'proto' | 'pre' | 'sealed'

export type LatticeSourceKind =
  | 'dialogo'
  | 'chat_import'
  | 'audio'
  | 'blob'
  | 'notebook'
  | 'bookmark'
  | 'manual'

export type QuantomoMeta = {
  source_kind: LatticeSourceKind | string
  title: string
  content: string
  universe: string | null
  hermetic_weight: number
  human_weight: number | null
  suggested_weight: number | null
  timestamp_iso: string | null
  amazona_index: number
  graph_degree: number
  flags: number
  embed_sketch: number[]
}

export type SealedLattice = {
  codec: typeof L72_CODEC
  generation: number
  permutation_id: number
  cells: Buffer
  seal: string
  premium: number
  domain_energies: number[]
}

function envKey(): string {
  return (process.env.DEPRO_LATTICE_KEY ?? '').replace(/^["']|["']$/g, '')
}

export function clampWeight(n: number | null | undefined): number {
  const w = Math.round(Number(n) || 0)
  return Math.max(1, Math.min(12, w || 1))
}

export function isPremiumWeight(weight: number): boolean {
  return clampWeight(weight) >= 7
}

function fnv(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function crc16(text: string): number {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) & 0xff
    for (let b = 0; b < 8; b++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
    }
  }
  return crc & 0xffff
}

function toI16(n: number): number {
  const x = Math.round(n)
  if (x > 32767) return 32767
  if (x < -32767) return -32767
  return x
}

function sourceCode(kind: string): number {
  const map: Record<string, number> = {
    dialogo: 1,
    chat_import: 2,
    audio: 3,
    blob: 4,
    notebook: 5,
    bookmark: 6,
    manual: 7,
  }
  return map[kind] ?? 0
}

export function latticeKey(runId: string | null | undefined): Buffer {
  const explicit = envKey()
  if (explicit) {
    return createHash('sha256').update(`depro-l72|${explicit}`).digest()
  }
  const run = (runId ?? 'local-run').trim() || 'local-run'
  return createHash('sha256').update(`depro-l72|run|${run}`).digest()
}

function permutationSeed(
  runId: string,
  quantomoId: string,
  generation: number,
): number {
  return fnv(`${runId}|${quantomoId}|${generation}|${L72_CODEC}`)
}

function blockPermutation(seed: number, domain: number): number[] {
  let s = (seed ^ Math.imul(domain + 1, 0x9e3779b9)) >>> 0
  const idx = Array.from({ length: L72_BLOCK }, (_, i) => i)
  for (let i = L72_BLOCK - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    const tmp = idx[i]!
    idx[i] = idx[j]!
    idx[j] = tmp
  }
  return idx
}

export function permuteCells(
  cells: Int16Array,
  seed: number,
): { permuted: Int16Array; permutationId: number } {
  const out = new Int16Array(L72_CELLS)
  for (let d = 0; d < L72_DOMAINS; d++) {
    const perm = blockPermutation(seed, d)
    const base = d * L72_BLOCK
    for (let i = 0; i < L72_BLOCK; i++) {
      out[base + i] = cells[base + perm[i]!] ?? 0
    }
  }
  return { permuted: out, permutationId: seed >>> 0 }
}

export function unpermuteCells(
  cells: Int16Array,
  seed: number,
): Int16Array {
  const out = new Int16Array(L72_CELLS)
  for (let d = 0; d < L72_DOMAINS; d++) {
    const perm = blockPermutation(seed, d)
    const base = d * L72_BLOCK
    for (let i = 0; i < L72_BLOCK; i++) {
      out[base + perm[i]!] = cells[base + i] ?? 0
    }
  }
  return out
}

export function encodeMeta(meta: QuantomoMeta): Int16Array {
  const cells = new Int16Array(L72_CELLS)
  const titleCrc = crc16(meta.title)
  const uniCrc = crc16(meta.universe ?? '')
  const tsBucket = meta.timestamp_iso
    ? Math.floor(new Date(meta.timestamp_iso).getTime() / 86_400_000) % 32767
    : 0
  const w = clampWeight(meta.hermetic_weight)
  const hw = meta.human_weight != null ? clampWeight(meta.human_weight) : 0
  const sw =
    meta.suggested_weight != null ? clampWeight(meta.suggested_weight) : 0
  const packedWeights = (w & 0xf) | ((hw & 0xf) << 4) | ((sw & 0xf) << 8)
  const amazona = ((meta.amazona_index % 72) + 72) % 72
  const degree = Math.max(0, Math.min(32767, meta.graph_degree | 0))
  const flags = meta.flags | 0
  const src = sourceCode(meta.source_kind)
  const len = Math.min(32767, (meta.content ?? '').length)

  for (let d = 0; d < L72_DOMAINS; d++) {
    const base = d * L72_BLOCK
    const sketch = meta.embed_sketch[d] ?? 0
    cells[base + 0] = toI16(src * 100 + d)
    cells[base + 1] = toI16(titleCrc ^ (d * 17))
    cells[base + 2] = toI16(uniCrc ^ (d * 31))
    cells[base + 3] = toI16(tsBucket + amazona * 3 + d)
    cells[base + 4] = toI16(packedWeights + d * 12)
    cells[base + 5] = toI16(flags ^ (d << 3))
    cells[base + 6] = toI16(degree + d)
    cells[base + 7] = toI16(sketch * 1000)
    cells[base + 8] = toI16(len ^ (d * 13))
  }
  return cells
}

export function domainEnergies(cells: Int16Array): number[] {
  const out: number[] = []
  for (let d = 0; d < L72_DOMAINS; d++) {
    let acc = 0
    const base = d * L72_BLOCK
    for (let i = 0; i < L72_BLOCK; i++) {
      const v = cells[base + i] ?? 0
      acc += v * v
    }
    out.push(Math.sqrt(acc))
  }
  return out
}

export function cellsToBuffer(cells: Int16Array): Buffer {
  const buf = Buffer.alloc(L72_BYTES)
  for (let i = 0; i < L72_CELLS; i++) {
    buf.writeInt16LE(cells[i] ?? 0, i * 2)
  }
  return buf
}

export function bufferToCells(buf: Buffer | Uint8Array): Int16Array {
  const cells = new Int16Array(L72_CELLS)
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  for (let i = 0; i < L72_CELLS; i++) {
    if (i * 2 + 1 >= b.length) break
    cells[i] = b.readInt16LE(i * 2)
  }
  return cells
}

export function hmacSeal(
  cellsBuf: Buffer,
  quantomoId: string,
  generation: number,
  permutationId: number,
  key: Buffer,
): string {
  return createHmac('sha256', key)
    .update(cellsBuf)
    .update('|')
    .update(quantomoId)
    .update('|')
    .update(String(generation))
    .update('|')
    .update(String(permutationId >>> 0))
    .digest('hex')
}

export function verifySeal(
  lattice: Pick<SealedLattice, 'cells' | 'seal' | 'generation' | 'permutation_id'>,
  quantomoId: string,
  key: Buffer,
): boolean {
  const expected = hmacSeal(
    lattice.cells,
    quantomoId,
    lattice.generation,
    lattice.permutation_id,
    key,
  )
  return expected === lattice.seal
}

export function sealLattice(opts: {
  meta: QuantomoMeta
  quantomoId: string
  runId: string
  generation: number
}): SealedLattice {
  const key = latticeKey(opts.runId)
  const canonical = encodeMeta(opts.meta)
  const seed = permutationSeed(opts.runId, opts.quantomoId, opts.generation)
  const { permuted, permutationId } = permuteCells(canonical, seed)
  const cells = cellsToBuffer(permuted)
  const seal = hmacSeal(
    cells,
    opts.quantomoId,
    opts.generation,
    permutationId,
    key,
  )
  const premium =
    isPremiumWeight(opts.meta.hermetic_weight) && opts.generation >= 1 ? 1 : 0
  return {
    codec: L72_CODEC,
    generation: opts.generation,
    permutation_id: permutationId,
    cells,
    seal,
    premium,
    domain_energies: domainEnergies(canonical),
  }
}

export function decodeLattice(
  lattice: SealedLattice,
  quantomoId: string,
  runId: string,
): { ok: boolean; canonical: Int16Array | null } {
  const key = latticeKey(runId)
  if (!verifySeal(lattice, quantomoId, key)) {
    return { ok: false, canonical: null }
  }
  const permuted = bufferToCells(lattice.cells)
  const seed = permutationSeed(runId, quantomoId, lattice.generation)
  return { ok: true, canonical: unpermuteCells(permuted, seed) }
}

export function resonance(a: Int16Array, b: Int16Array, weight = 7): number {
  if (a.length !== L72_CELLS || b.length !== L72_CELLS) return 0
  let acc = 0
  for (let d = 0; d < L72_DOMAINS; d++) {
    let dot = 0
    let na = 0
    let nb = 0
    const base = d * L72_BLOCK
    for (let i = 0; i < L72_BLOCK; i++) {
      const va = a[base + i] ?? 0
      const vb = b[base + i] ?? 0
      dot += va * vb
      na += va * va
      nb += vb * vb
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb)
    acc += denom > 0 ? dot / denom : 0
  }
  const w = clampWeight(weight) / 12
  return (acc / L72_DOMAINS) * (0.55 + 0.45 * w)
}

export function hybridScore(opts: {
  fts: number
  embedding: number
  lattice: number
}): number {
  return opts.fts * 0.25 + opts.embedding * 0.4 + opts.lattice * 0.35
}

export function latticeToPacket(
  quantomoId: string,
  lattice: SealedLattice,
  face?: { title?: string; content?: string | null },
): Record<string, unknown> {
  return {
    id: quantomoId,
    title: face?.title,
    content: face?.content,
    lattice_b64: lattice.cells.toString('base64'),
    seal: lattice.seal,
    codec: lattice.codec,
    generation: lattice.generation,
    permutation_id: lattice.permutation_id,
    premium: lattice.premium,
    domain_energies: lattice.domain_energies,
  }
}

export function randomSketch(n = L72_DOMAINS): number[] {
  const buf = randomBytes(n)
  return Array.from(buf, (b) => (b - 128) / 128)
}
