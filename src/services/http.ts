export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    const ctype = res.headers.get('content-type') || ''
    try {
      if (ctype.includes('json')) {
        const err = (await res.json()) as { error?: string }
        if (err.error) message = err.error
      }
    } catch {
      /* ignore */
    }
    if (
      message === `HTTP ${res.status}` &&
      (res.status === 500 || res.status === 502)
    ) {
      message =
        'La API no está corriendo. Cerrá y volvé a npm run dev con Node 24.'
    }
    throw new Error(message)
  }

  return (await res.json()) as T
}
