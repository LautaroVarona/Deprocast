import type { GeografiaTreeNode } from '../../types'

type Props = {
  nodes: GeografiaTreeNode[]
  selectedId: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}

function weightMark(w: number | undefined): string {
  const n = w ?? 0
  if (n <= 0) return ''
  return ` · ${n}`
}

function NodeRow({
  node,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: Props & { node: GeografiaTreeNode; depth: number }) {
  const hasKids = node.children.length > 0
  const open = expanded.has(node.id)
  const typeLabel = node.admin_type || node.kind
  return (
    <li>
      <div
        className={
          selectedId === node.id ? 'atlas-tree-row is-active' : 'atlas-tree-row'
        }
        style={{ paddingLeft: `${0.35 + depth * 0.85}rem` }}
      >
        {hasKids ? (
          <button
            type="button"
            className="atlas-tree-twist"
            aria-label={open ? 'Cerrar' : 'Abrir'}
            onClick={() => onToggle(node.id)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="atlas-tree-twist is-leaf">·</span>
        )}
        <button
          type="button"
          className="atlas-tree-name"
          onClick={() => onSelect(node.id)}
        >
          <span>{node.name}</span>
          <em>
            {typeLabel}
            {weightMark(node.human_weight)}
          </em>
        </button>
      </div>
      {hasKids && open ? (
        <ul className="atlas-tree-sub">
          {node.children.map((c) => (
            <NodeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              nodes={[]}
              selectedId={selectedId}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function AtlasTree({
  nodes,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: Props) {
  return (
    <ul className="atlas-tree">
      {nodes.map((n) => (
        <NodeRow
          key={n.id}
          node={n}
          depth={0}
          nodes={[]}
          selectedId={selectedId}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}
