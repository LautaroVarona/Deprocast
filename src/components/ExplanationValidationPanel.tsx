import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import type { Notebook, NotebookPage } from '../types'

const EXPLANATION_SEPARATOR = '____________________'

/** Misma mapa que Criba: 1–9, 0→10, .→11, Enter→12. */
function keyToWeight(e: KeyboardEvent): number | null {
  const k = e.key
  if (k >= '1' && k <= '9') return Number(k)
  if (k === '0' || k === 'q' || k === 'Q') return 10
  if (k === "'" || k === '.' || k === 'w' || k === 'W') return 11
  if (k === '¡' || k === 'Enter' || k === 'e' || k === 'E') return 12
  return null
}

function splitExplanation(
  full: string | null | undefined,
  userStored?: string | null,
): { user: string; ai: string } {
  const storedUser = (userStored || '').trim()
  const text = (full || '').trim()
  if (storedUser) {
    const idx = text.indexOf(EXPLANATION_SEPARATOR)
    if (idx >= 0) {
      return {
        user: storedUser,
        ai: text
          .slice(idx + EXPLANATION_SEPARATOR.length)
          .replace(/^\n+/, '')
          .trim(),
      }
    }
    if (text === storedUser) return { user: storedUser, ai: '' }
    if (text.startsWith(storedUser)) {
      return {
        user: storedUser,
        ai: text.slice(storedUser.length).replace(/^\n+/, '').trim(),
      }
    }
    return { user: storedUser, ai: '' }
  }
  const wrapped = `\n${EXPLANATION_SEPARATOR}\n`
  const idx = text.indexOf(wrapped)
  if (idx >= 0) {
    return {
      user: text.slice(0, idx).trim(),
      ai: text.slice(idx + wrapped.length).trim(),
    }
  }
  const idx2 = text.indexOf(EXPLANATION_SEPARATOR)
  if (idx2 >= 0) {
    return {
      user: text.slice(0, idx2).trim(),
      ai: text
        .slice(idx2 + EXPLANATION_SEPARATOR.length)
        .replace(/^\n+/, '')
        .trim(),
    }
  }
  return { user: '', ai: text }
}

function pageHasAiExplanation(p: NotebookPage): boolean {
  return splitExplanation(p.explanation, p.explanation_user).ai.length > 0
}

function pageLabel(p: NotebookPage): string {
  const pos =
    p.posicion_visual === 'ImpactoTapa' ? 'Tapa' : p.posicion_visual
  if (pos === 'Tapa') return 'Tapa'
  if (pos === 'Contratapa') return 'Contratapa'
  if (pos === 'Suelta') return `Página ${p.numero_logico}`
  const side = pos === 'Izquierda' ? 'Izq' : 'Der'
  return `Página ${p.numero_logico} · ${side}`
}

export function ExplanationValidationPanel({
  notebook,
  pages,
  initialSlot,
  onBack,
  onChanged,
  onSlotChange,
}: {
  notebook: Notebook
  pages: NotebookPage[]
  initialSlot: number
  onBack: () => void
  onChanged: () => void
  onSlotChange?: (slot: number) => void
}) {
  const queue = useMemo(
    () =>
      pages
        .filter((p) => p.status === 'Validada' && pageHasAiExplanation(p))
        .map((p) => p.slot_index)
        .sort((a, b) => a - b),
    [pages],
  )

  const startSlot = useMemo(() => {
    if (queue.includes(initialSlot)) return initialSlot
    return queue[0] ?? initialSlot
  }, [queue, initialSlot])

  const [slot, setSlot] = useState(startSlot)
  const [page, setPage] = useState<NotebookPage | null>(null)
  const [label, setLabel] = useState('')
  const [userNote, setUserNote] = useState('')
  const [explanationAi, setExplanationAi] = useState('')
  const [weight, setWeight] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [imgTick, setImgTick] = useState(0)
  const [doneSlots, setDoneSlots] = useState<number[]>([])

  const activeQueue = useMemo(
    () => queue.filter((s) => !doneSlots.includes(s)),
    [queue, doneSlots],
  )
  const queuePos = activeQueue.indexOf(slot)
  const remaining = activeQueue.length

  const goSlot = (next: number) => {
    setSlot(next)
    onSlotChange?.(next)
  }

  const load = async (targetSlot: number) => {
    const res = await api.getNotebookPage(notebook.id, targetSlot)
    setPage(res.page)
    setLabel(res.label)
    const split = splitExplanation(
      res.page.explanation,
      res.page.explanation_user,
    )
    setUserNote(split.user)
    setExplanationAi(split.ai)
    setWeight(
      res.page.explanation_weight != null
        ? Number(res.page.explanation_weight)
        : null,
    )
    setImgTick((t) => t + 1)
  }

  useEffect(() => {
    setError(null)
    setMsg(null)
    void load(slot).catch((e) =>
      setError(e instanceof Error ? e.message : 'Error'),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebook.id, slot])

  const integrar = useCallback(
    async (weightOverride?: number) => {
      const w = weightOverride ?? weight
      if (w == null) {
        setError('Valorá la explicación del 1 al 12')
        return
      }
      if (!explanationAi.trim()) {
        setError('La explicación no puede quedar vacía')
        return
      }
      if (busy) return
      const savedSlot = slot
      const savedAi = explanationAi
      const savedUser = userNote
      setWeight(w)
      setBusy(true)
      setError(null)
      setMsg(null)
      try {
        await api.validateNotebookExplanation(notebook.id, savedSlot, {
          weight: w,
          explanation_ai: savedAi,
          explanation: savedUser,
        })
        // Corpus (NER/embed) sigue en cola; no esperamos Procesada.
        const nextDone = [...doneSlots, savedSlot]
        setDoneSlots(nextDone)
        onChanged()
        const nextQueue = queue.filter((s) => !nextDone.includes(s))
        const after = nextQueue.find((s) => s > savedSlot)
        const next = after ?? nextQueue[0]
        if (next != null) {
          setSlot(next)
          onSlotChange?.(next)
        } else {
          onBack()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al integrar')
      } finally {
        setBusy(false)
      }
    },
    [
      weight,
      explanationAi,
      userNote,
      busy,
      slot,
      notebook.id,
      doneSlots,
      onChanged,
      queue,
      onBack,
      onSlotChange,
    ],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (t?.isContentEditable) return
      if (busy) return
      const w = keyToWeight(e)
      if (w == null) return
      e.preventDefault()
      void integrar(w)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [integrar, busy])

  if (!page) {
    return (
      <section className="nb-section nb-validate nb-explain-validate is-fit">
        <button type="button" className="btn btn-ghost btn-tiny" onClick={onBack}>
          ← Volver
        </button>
        <p className="muted">{error || 'Cargando…'}</p>
      </section>
    )
  }

  if (remaining === 0 && !busy) {
    return (
      <section className="nb-section nb-validate nb-explain-validate is-fit">
        <button type="button" className="btn btn-ghost btn-tiny" onClick={onBack}>
          ← Spreads
        </button>
        <p className="muted">
          No hay hojas Validada con explicación IA pendientes de integrar.
        </p>
      </section>
    )
  }

  const imageUrl = `${api.notebookPageImageUrl(notebook.id, slot)}?v=${imgTick}`

  return (
    <section className="nb-section nb-validate nb-explain-validate is-fit">
      <div className="nb-reader-bar nb-validate-top">
        <button type="button" className="btn btn-ghost btn-tiny" onClick={onBack}>
          ← Spreads
        </button>
        <div className="nb-validate-nav">
          <button
            type="button"
            className="btn btn-tiny"
            disabled={busy || queuePos <= 0}
            onClick={() => {
              const prev = activeQueue[queuePos - 1]
              if (prev != null) goSlot(prev)
            }}
          >
            ← Anterior
          </button>
          <span className="nb-validate-slot-label">
            Validar explicaciones
            <span className="muted">
              {' '}
              · {label}
              {queuePos >= 0
                ? ` · ${queuePos + 1}/${activeQueue.length}`
                : ''}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={
              busy || queuePos < 0 || queuePos >= activeQueue.length - 1
            }
            onClick={() => {
              const next = activeQueue[queuePos + 1]
              if (next != null) goSlot(next)
            }}
          >
            Siguiente →
          </button>
        </div>
        <div className="nb-reader-actions">
          <button
            type="button"
            className="btn btn-primary btn-tiny"
            disabled={busy || weight == null || !explanationAi.trim()}
            title={
              weight == null
                ? 'Elegí un peso del 1 al 12'
                : 'Guardar explicación, peso e integrar al corpus'
            }
            onClick={() => void integrar(undefined)}
          >
            {busy ? 'Integrando…' : 'Integrar'}
          </button>
        </div>
      </div>

      {(error || msg) && (
        <div className="nb-validate-flash">
          {error && <span className="nb-error">{error}</span>}
          {msg && <span className="nb-ok">{msg}</span>}
        </div>
      )}

      <div className="nb-validate-split nb-explain-validate-split is-fit">
        <div className="nb-validate-image">
          {page.image_path ? (
            <img src={imageUrl} alt={label} />
          ) : (
            <div className="nb-face-empty">Sin imagen</div>
          )}
        </div>

        <div className="nb-validate-form nb-explain-validate-form is-fit">
          <header className="nb-explain-validate-head">
            <h2>{page.title?.trim() || pageLabel(page)}</h2>
            <p className="muted">
              Contrastá la imagen con el texto. Editá si hace falta, valorá 1–12
              e integrá al corpus.
            </p>
          </header>

          {userNote.trim() ? (
            <label className="nb-explain-user-note">
              Nota del operador
              <textarea
                className="nb-textarea is-user-explain"
                value={userNote}
                onChange={(e) => setUserNote(e.target.value)}
                rows={3}
                spellCheck
              />
            </label>
          ) : null}

          <label className="nb-grow-area nb-pane-field">
            <span className="nb-explain-field-label">Explicación</span>
            <textarea
              className="nb-textarea nb-explain-validate-text"
              value={explanationAi}
              onChange={(e) => setExplanationAi(e.target.value)}
              placeholder="Texto explicativo a validar contra la hoja…"
              spellCheck
            />
          </label>

          <div className="nb-explain-vote" role="group" aria-label="Peso 1 a 12">
            <span className="nb-explain-vote-label">Valoración</span>
            <div className="nb-explain-weights">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
                <button
                  key={w}
                  type="button"
                  className={`btn btn-tiny nb-explain-w${weight === w ? ' is-active' : ''}${w <= 3 ? ' is-slop' : ''}`}
                  disabled={busy}
                  onClick={() => void integrar(w)}
                  title={
                    w <= 9
                      ? `Tecla ${w}`
                      : w === 10
                        ? 'Tecla 0'
                        : w === 11
                          ? 'Tecla .'
                          : 'Tecla Enter'
                  }
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
