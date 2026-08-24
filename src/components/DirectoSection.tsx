import { useLiveSession } from '../live/LiveSessionContext'

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function DirectoSection() {
  const { status, interim, finalBlocks, error, start, stop, clearFeed } =
    useLiveSession()

  const listening = status === 'listening'
  const connecting = status === 'connecting'
  const busy = listening || connecting

  return (
    <section className="directo-section panel">
      <header className="directo-head">
        <div className="directo-title-row">
          <span
            className={
              listening
                ? 'directo-presence is-live'
                : connecting
                  ? 'directo-presence is-connecting'
                  : 'directo-presence'
            }
            aria-hidden
          />
          <div>
            <h2>Directo</h2>
            <p className="muted directo-lead">
              Bitácora de escucha en vivo. El micrófono envía audio a Deepgram y
              los bloques finales se apilan aquí (solo en esta sesión). Para
              persistir pantalla + transcript hacia Aduana, usá la extensión El
              Cofre.
            </p>
          </div>
        </div>

        <div className="directo-controls">
          <button
            type="button"
            className={
              listening
                ? 'btn btn-primary directo-toggle is-on'
                : 'btn btn-primary directo-toggle'
            }
            disabled={connecting}
            onClick={() => {
              if (busy) stop()
              else void start()
            }}
          >
            {connecting
              ? 'Conectando…'
              : listening
                ? 'Detener escucha'
                : 'Iniciar escucha'}
          </button>
          <button
            type="button"
            className="btn btn-tiny"
            disabled={finalBlocks.length === 0 && !interim}
            onClick={clearFeed}
          >
            Limpiar feed
          </button>
        </div>
      </header>

      <p
        className={
          listening
            ? 'directo-status is-live'
            : connecting
              ? 'directo-status is-connecting'
              : status === 'error'
                ? 'directo-status is-error'
                : 'directo-status'
        }
        role="status"
      >
        {listening
          ? 'Escuchando el entorno'
          : connecting
            ? 'Pidiendo micrófono y abriendo canal…'
            : status === 'error'
              ? error ?? 'Error'
              : 'Apagado'}
      </p>

      {error && status === 'error' && (
        <p className="directo-error" role="alert">
          {error}
        </p>
      )}

      <div className="live-feed directo-feed">
        <div className="live-feed-head">
          <h3>Feed de hoy</h3>
          <p className="muted live-meta">
            {finalBlocks.length} bloque{finalBlocks.length === 1 ? '' : 's'} ·
            interim en gris
          </p>
        </div>

        <div className="transcript-live directo-transcript">
          {finalBlocks.length === 0 && !interim && (
            <p className="muted directo-empty">
              Activá la escucha. Al hablar verás texto provisional; al pausar,
              el bloque queda fijo.
            </p>
          )}
          {finalBlocks.map((block) => (
            <article key={block.id} className="directo-block">
              <time className="directo-block-time" dateTime={new Date(block.at).toISOString()}>
                {formatTime(block.at)}
              </time>
              <p className="transcript-final">{block.text}</p>
            </article>
          ))}
          {interim ? (
            <p className="transcript-interim">
              {interim}
              {listening && <span className="live-caret">▌</span>}
            </p>
          ) : (
            listening && <span className="live-caret">▌</span>
          )}
        </div>
      </div>
    </section>
  )
}
