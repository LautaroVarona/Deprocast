const TOKEN_KEY = 'localApiToken'

export async function getExtensionToken(): Promise<string | null> {
  const bag = await chrome.storage.local.get(TOKEN_KEY)
  const v = bag[TOKEN_KEY]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function setExtensionToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token.trim() })
}

export async function authHeaders(): Promise<HeadersInit> {
  const token = await getExtensionToken()
  return token ? { 'X-Deprocast-Token': token } : {}
}

export async function authFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = {
    ...(init?.headers ?? {}),
    ...(await authHeaders()),
  }
  return fetch(input, { ...init, headers })
}
