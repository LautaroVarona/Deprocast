import type { ChatBlock, ChatSpeakerMap } from '../../types'

type Props = {
  block: ChatBlock
  selected: boolean
  speakers: ChatSpeakerMap[]
  onSelect: () => void
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso.replace('T', ' ').slice(0, 16)
  }
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function clip(text: string, n = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n).trim()}…`
}

function speakerLabel(
  remitente: string | null,
  speakers: ChatSpeakerMap[],
): { name: string; isAi: boolean } {
  if (!remitente) return { name: 'Sistema', isAi: false }
  const hit = speakers.find((s) => s.remitente === remitente)
  return {
    name: hit?.person_name || remitente,
    isAi: Boolean(hit?.is_ai),
  }
}

export function ChatJornadaCard({
  block,
  selected,
  speakers,
  onSelect,
  compact = false,
}: Props & { compact?: boolean }) {
  const preview = block.preview_messages ?? []
  if (compact) {
    const previewLine = preview[0]?.texto_crudo?.replace(/\s+/g, ' ').trim()
    const when = new Date(block.started_at)
    const label = Number.isNaN(when.getTime())
      ? block.day_key
      : when.toLocaleDateString('es-ES', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
    return (
      <button
        type="button"
        className={
          selected ? 'chat-chat-row is-selected' : 'chat-chat-row'
        }
        onClick={onSelect}
      >
        <strong>{label}</strong>
        <span className="chat-chat-row-meta">
          {block.message_count} msgs · {block.estado}
          {block.human_weight != null ? ` · ${block.human_weight}` : ''}
        </span>
        {previewLine ? (
          <span className="chat-chat-row-preview">{clip(previewLine, 72)}</span>
        ) : null}
      </button>
    )
  }
  return (
    <button
      type="button"
      className={selected ? 'chat-jornada is-selected' : 'chat-jornada'}
      onClick={onSelect}
    >
      <div className="chat-jornada-top">
        <strong>{block.day_key}</strong>
        <span className={`chat-pill chat-pill-${block.estado}`}>
          {block.estado}
        </span>
      </div>
      <p className="chat-jornada-meta">
        {formatTs(block.started_at)} → {formatTs(block.ended_at)}
        {' · '}
        {block.message_count} msgs
        {block.human_weight != null ? ` · peso ${block.human_weight}` : ''}
      </p>
      {speakers.length > 0 && (
        <div className="chat-jornada-speakers">
          {speakers.map((s) => (
            <span
              key={s.remitente}
              className={s.is_ai ? 'chat-chip chat-chip-ia' : 'chat-chip'}
            >
              {s.person_name || s.remitente}
              {s.is_ai ? ' · IA' : ''}
            </span>
          ))}
        </div>
      )}
      {preview.length > 0 ? (
        <ul className="chat-jornada-preview">
          {preview.map((m) => {
            const who = speakerLabel(m.remitente, speakers)
            return (
              <li key={m.id}>
                <span className={who.isAi ? 'chat-chip-ia-inline' : undefined}>
                  {who.name}
                  {who.isAi ? ' · IA' : ''}
                </span>
                {clip(m.texto_crudo)}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="muted chat-jornada-empty">Sin preview de mensajes</p>
      )}
    </button>
  )
}

export function monthKeyFromDay(dayKey: string): string {
  return dayKey.slice(0, 7)
}

export function monthLabelFromKey(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(y, m - 1, 1)
  return d.toLocaleString('es-ES', { month: 'long', year: 'numeric' })
}
