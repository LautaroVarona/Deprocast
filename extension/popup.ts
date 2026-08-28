import { SERVER_ORIGIN, type CofreState, type SwToPopup } from './protocol'
import { getExtensionToken, setExtensionToken } from './auth'

const healthEl = document.getElementById('health') as HTMLParagraphElement
const statusEl = document.getElementById('status') as HTMLParagraphElement
const errorEl = document.getElementById('error') as HTMLParagraphElement
const markEl = document.getElementById('mark') as HTMLSpanElement
const micEl = document.getElementById('mic') as HTMLInputElement
const tokenEl = document.getElementById('token') as HTMLInputElement
const btnDesktop = document.getElementById('btn-desktop') as HTMLButtonElement
const btnTab = document.getElementById('btn-tab') as HTMLButtonElement
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement
const btnRetry = document.getElementById('btn-retry') as HTMLButtonElement

let healthOk = false

function send(message: unknown): Promise<SwToPopup> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (raw) => {
      const err = chrome.runtime.lastError
      if (err?.message) {
        reject(new Error(err.message))
        return
      }
      resolve((raw ?? { ok: false, error: 'Sin respuesta' }) as SwToPopup)
    })
  })
}

function setError(text: string | null): void {
  if (!text) {
    errorEl.hidden = true
    errorEl.textContent = ''
    return
  }
  errorEl.hidden = false
  errorEl.textContent = text
}

function render(next: CofreState): void {
  markEl.className = 'mark'
  btnStop.hidden = true
  btnRetry.hidden = true
  btnDesktop.disabled = false
  btnTab.disabled = false
  micEl.disabled = false

  if (next.status === 'recording') {
    markEl.classList.add('live')
    const since = next.startedAt
      ? Math.max(0, Math.round((Date.now() - next.startedAt) / 1000))
      : 0
    statusEl.textContent = `Grabando${next.captureMode === 'tab' ? ' pestaña' : ''} · ${since}s${
      next.micDenied ? ' · sin mic' : ''
    }`
    btnStop.hidden = false
    btnDesktop.disabled = true
    btnTab.disabled = true
    micEl.disabled = true
  } else if (next.status === 'uploading') {
    markEl.classList.add('warn')
    statusEl.textContent = 'Empaquetando y enviando al vault…'
    btnDesktop.disabled = true
    btnTab.disabled = true
    micEl.disabled = true
  } else if (next.status === 'error') {
    markEl.classList.add('warn')
    statusEl.textContent = 'Error'
    setError(next.error)
    if (next.error && /captura pendiente|servidor|HTTP|enviar/i.test(next.error)) {
      btnRetry.hidden = false
    }
  } else {
    markEl.classList.add(healthOk ? 'ok' : '')
    statusEl.textContent = next.lastTitle
      ? `Último envío: ${next.lastTitle}`
      : 'Listo.'
    setError(null)
  }

  if (!healthOk && next.status === 'idle') {
    btnDesktop.disabled = true
    btnTab.disabled = true
  }
}

async function refreshState(): Promise<void> {
  const res = await send({ type: 'GET_STATE' })
  if (res.state) render(res.state)
}

async function pingHealth(): Promise<void> {
  try {
    const res = await fetch(`${SERVER_ORIGIN}/api/health`)
    healthOk = res.ok
    const token = await getExtensionToken()
    healthEl.textContent = healthOk
      ? token
        ? 'Deprocast local en línea'
        : 'Servidor OK · falta token local'
      : 'Servidor local no responde'
    healthEl.className = healthOk ? 'health up' : 'health down'
  } catch {
    healthOk = false
    healthEl.textContent = 'Servidor local no responde (¿npm run server?)'
    healthEl.className = 'health down'
  }
}

function chooseDesktop(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(
      ['screen', 'window', 'tab', 'audio'],
      (sourceId) => {
        if (!sourceId) {
          reject(new Error('Captura cancelada'))
          return
        }
        resolve(sourceId)
      },
    )
  })
}

btnDesktop.addEventListener('click', () => {
  void (async () => {
    setError(null)
    try {
      const desktopSourceId = await chooseDesktop()
      const res = await send({
        type: 'START',
        desktopSourceId,
        captureMode: 'desktop',
        includeMic: micEl.checked,
      })
      if (res.state) render(res.state)
      if (!res.ok) setError(res.error ?? 'No se pudo iniciar')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg !== 'Captura cancelada') setError(msg)
    }
  })()
})

btnTab.addEventListener('click', () => {
  void (async () => {
    setError(null)
    try {
      const res = await send({
        type: 'START',
        desktopSourceId: null,
        captureMode: 'tab',
        includeMic: micEl.checked,
      })
      if (res.state) render(res.state)
      if (!res.ok) setError(res.error ?? 'No se pudo iniciar')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  })()
})

btnStop.addEventListener('click', () => {
  void (async () => {
    setError(null)
    try {
      const res = await send({ type: 'STOP' })
      if (res.state) render(res.state)
      if (!res.ok) setError(res.error ?? 'No se pudo detener')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  })()
})

btnRetry.addEventListener('click', () => {
  void (async () => {
    setError(null)
    try {
      const res = await send({ type: 'RETRY_UPLOAD' })
      if (res.state) render(res.state)
      if (!res.ok) setError(res.error ?? 'Reintento fallido')
      else if (res.entry) {
        statusEl.textContent = `Enviado: ${res.entry.title}`
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  })()
})

void (async () => {
  const stored = await getExtensionToken()
  if (stored) tokenEl.value = stored
  tokenEl.addEventListener('change', () => {
    void setExtensionToken(tokenEl.value)
  })
  await pingHealth()
  try {
    await refreshState()
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
})()
