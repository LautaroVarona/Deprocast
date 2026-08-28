/**
 * Benchmark local de cosine N×N (DEPRO-017/Fase 4).
 * Uso: node scripts/benchmark-graph.mjs 1000
 */
const n = Math.max(10, Number(process.argv[2] || 1000))
const dim = 64
const vecs = Array.from({ length: n }, () => {
  const v = Float64Array.from({ length: dim }, () => Math.random())
  let s = 0
  for (const x of v) s += x * x
  const nrm = Math.sqrt(s) || 1
  return v.map((x) => x / nrm)
})

function cosine(a, b) {
  let d = 0
  for (let i = 0; i < a.length; i++) d += a[i] * b[i]
  return d
}

const t0 = performance.now()
let edges = 0
const k = 4
for (let i = 0; i < n; i++) {
  const scored = []
  for (let j = 0; j < n; j++) {
    if (i === j) continue
    scored.push(cosine(vecs[i], vecs[j]))
  }
  scored.sort((a, b) => b - a)
  edges += k
}
const ms = performance.now() - t0
console.log(
  JSON.stringify({ n, dim, ms: Math.round(ms), edges, p95hint_ms: Math.round(ms) }),
)
