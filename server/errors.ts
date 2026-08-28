export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly expose: boolean

  constructor(
    message: string,
    status = 400,
    code = 'BAD_REQUEST',
    expose = true,
  ) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.expose = expose
  }
}

export function publicError(err: unknown): {
  status: number
  body: { error: string; code?: string }
} {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { error: err.expose ? err.message : 'Error interno', code: err.code },
    }
  }
  if (err instanceof Error) {
    return { status: 500, body: { error: err.message } }
  }
  return { status: 500, body: { error: 'Error interno' } }
}
