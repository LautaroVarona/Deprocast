const MAX_WALK = 50_000

export function collectDescendantIds(
  rootId: string,
  childrenOf: (id: string) => string[],
): string[] {
  const out: string[] = []
  const visited = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length > 0) {
    if (out.length + queue.length > MAX_WALK) {
      throw new Error('Árbol de entradas demasiado profundo o cíclico')
    }
    const id = queue.shift()!
    for (const kid of childrenOf(id)) {
      if (visited.has(kid)) continue
      visited.add(kid)
      out.push(kid)
      queue.push(kid)
    }
  }
  return out
}

export function buildAcyclicForest<T extends { id: string; parent_id?: string | null }>(
  nodes: T[],
): Array<T & { children: Array<T & { children: unknown[] }> }> {
  const byParent = new Map<string | null, T[]>()
  for (const n of nodes) {
    const key = n.parent_id ?? null
    const list = byParent.get(key) ?? []
    list.push(n)
    byParent.set(key, list)
  }
  const visiting = new Set<string>()
  const done = new Set<string>()
  const build = (
    parentId: string | null,
  ): Array<T & { children: Array<T & { children: unknown[] }> }> => {
    const kids = byParent.get(parentId) ?? []
    const out: Array<T & { children: Array<T & { children: unknown[] }> }> = []
    for (const g of kids) {
      if (visiting.has(g.id)) continue
      if (done.has(g.id) && parentId !== null) continue
      visiting.add(g.id)
      const children = build(g.id)
      visiting.delete(g.id)
      done.add(g.id)
      out.push({ ...g, children })
    }
    return out
  }
  return build(null)
}
