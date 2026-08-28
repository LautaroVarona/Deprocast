import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import { envNumber, readEnv } from '../config.js'

const TOKEN_HEADER = 'x-deprocast-token'
const COOKIE = 'deprocast_token'
const TOKEN_FILE = path.resolve(process.cwd(), 'data', 'local-token')

export const LOCAL_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:3001',
  'http://localhost:3001',
] as const

let cachedToken: string | null = null

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function getLocalApiToken(): string {
  if (cachedToken) return cachedToken
  const fromEnv = readEnv('LOCAL_API_TOKEN')
  if (fromEnv) {
    cachedToken = fromEnv
    return cachedToken
  }
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  if (fs.existsSync(TOKEN_FILE)) {
    const disk = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
    if (disk) {
      cachedToken = disk
      return cachedToken
    }
  }
  const token = generateToken()
  fs.writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600 })
  cachedToken = token
  return token
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  if ((LOCAL_ORIGINS as readonly string[]).includes(origin)) return true
  if (origin.startsWith('chrome-extension://')) return true
  return false
}

export function extractToken(req: Request): string | null {
  const header = req.header(TOKEN_HEADER) || req.header('authorization') || ''
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() || null
  }
  if (header && !header.toLowerCase().startsWith('bearer')) {
    const named = req.header(TOKEN_HEADER)
    if (named) return named.trim()
  }
  const q = typeof req.query.token === 'string' ? req.query.token.trim() : ''
  if (q) return q
  const cookie = req.headers.cookie || ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  if (m?.[1]) return decodeURIComponent(m[1])
  return null
}

export function tokenMatches(candidate: string | null | undefined): boolean {
  const expected = getLocalApiToken()
  if (!candidate) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

const PUBLIC_PATHS = new Set(['/api/health'])

export function localAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const pathName = req.path || req.url.split('?')[0] || ''
  if (req.method === 'GET' && (PUBLIC_PATHS.has(pathName) || pathName === '/api/health')) {
    next()
    return
  }
  const origin = req.header('origin')
  if (origin && !isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'Origen no permitido' })
    return
  }
  const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'
  if (mutating && !origin && !extractToken(req)) {
    res.status(401).json({ error: 'Falta capacidad local (token u Origin)' })
    return
  }
  if (!tokenMatches(extractToken(req))) {
    res.status(401).json({ error: 'Token local inválido o ausente' })
    return
  }
  next()
}

const hits = new Map<string, { window: number; n: number }>()

export function aiRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const limit = envNumber('AI_RPM_LIMIT', 30)
  const now = Date.now()
  const window = Math.floor(now / 60_000)
  const key = req.ip || 'local'
  const cur = hits.get(key)
  if (!cur || cur.window !== window) {
    hits.set(key, { window, n: 1 })
    next()
    return
  }
  cur.n += 1
  if (cur.n > limit) {
    res.status(429).json({ error: 'Cuota de IA excedida. Reintentá en un minuto.' })
    return
  }
  next()
}

export function corsOrigin(
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) {
    cb(null, true)
    return
  }
  cb(null, isAllowedOrigin(origin))
}
