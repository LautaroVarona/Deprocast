/**
 * Gestor de cola LLM: 1 petición a la vez + delay entre llamadas (anti-429).
 * Sin p-limit ni deps extra.
 */
import { envNumber } from '../config.js'

export type SerialQueueOptions = {
  /** Hueco mínimo entre el fin de una petición y el arranque de la siguiente. */
  delayMs?: number
  /** Solo 1 es el modo anti-rate-limit. >1 queda por si un test lo pide. */
  concurrency?: number
}

export type QueueTask<T> = () => Promise<T>

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class SerialQueue {
  readonly delayMs: number
  readonly concurrency: number
  private running = 0
  private lastFinishedAt = 0
  private readonly waiters: Array<() => void> = []

  constructor(opts: SerialQueueOptions = {}) {
    this.delayMs = Math.max(0, opts.delayMs ?? 0)
    this.concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1))
  }

  get pending(): number {
    return this.waiters.length
  }

  get active(): number {
    return this.running
  }

  enqueue<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        void this.run(task).then(resolve, reject)
      }
      if (this.running < this.concurrency) {
        start()
      } else {
        this.waiters.push(start)
      }
    })
  }

  /** Encola varias tareas; el gate las serializa. */
  map<T, R>(items: T[], mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
    return Promise.all(items.map((item, index) => this.enqueue(() => mapper(item, index))))
  }

  private async run<T>(task: QueueTask<T>): Promise<T> {
    this.running += 1
    try {
      const elapsed = Date.now() - this.lastFinishedAt
      const wait =
        this.lastFinishedAt === 0 ? 0 : Math.max(0, this.delayMs - elapsed)
      if (wait > 0) await delay(wait)
      return await task()
    } finally {
      this.lastFinishedAt = Date.now()
      this.running -= 1
      const next = this.waiters.shift()
      if (next) next()
    }
  }
}

let singleton: SerialQueue | null = null

export function llmQueueDelayMs(): number {
  return envNumber(
    'LLM_QUEUE_DELAY_MS',
    envNumber('GROQ_REQUEST_DELAY_MS', 800),
  )
}

/** Cola global de inferencia (Groq / Ollama). */
export function getLlmQueue(): SerialQueue {
  if (!singleton) {
    singleton = new SerialQueue({
      delayMs: llmQueueDelayMs(),
      concurrency: 1,
    })
  }
  return singleton
}

export function enqueueLlm<T>(task: QueueTask<T>): Promise<T> {
  return getLlmQueue().enqueue(task)
}

/** Solo tests: recrea la cola con delay conocido. */
export function resetLlmQueue(opts?: SerialQueueOptions): SerialQueue {
  singleton = new SerialQueue({
    delayMs: opts?.delayMs ?? llmQueueDelayMs(),
    concurrency: opts?.concurrency ?? 1,
  })
  return singleton
}
