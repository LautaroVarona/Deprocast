import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { NotebookPageVisionResult } from '../types.js'
import { notebookResultFromOcr } from './unlimitedOcr.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function firstLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean)
  return (line || 'Hoja sin título').slice(0, 80)
}

function toResult(text: string, notes: string): NotebookPageVisionResult {
  const transcription = text.replace(/\r\n/g, '\n').trim()
  const result = notebookResultFromOcr(transcription)
  result.meta = {
    ...(result.meta ?? { layout: 'unknown' }),
    notes,
  }
  if (!result.is_blank && result.title === 'Sin título') {
    result.title = firstLine(transcription)
  }
  return result
}

async function tryTesseractCli(imageAbsPath: string): Promise<string | null> {
  const bin = process.env.TESSERACT_PATH?.replace(/^["']|["']$/g, '').trim() || 'tesseract'
  try {
    const { stdout } = await execFileAsync(
      bin,
      [imageAbsPath, 'stdout', '-l', 'spa+eng', '--psm', '6'],
      { timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    )
    const text = String(stdout || '').trim()
    return text || null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/spa\+eng|Failed loading language/i.test(msg)) {
      try {
        const { stdout } = await execFileAsync(
          bin,
          [imageAbsPath, 'stdout', '--psm', '6'],
          { timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        )
        const text = String(stdout || '').trim()
        return text || null
      } catch {
        return null
      }
    }
    return null
  }
}

async function rasterizePng(imageAbsPath: string): Promise<string> {
  const { createCanvas, loadImage } =
    (await import('@napi-rs/canvas')) as typeof import('@napi-rs/canvas')
  const img = await loadImage(imageAbsPath)
  const maxEdge = 2000
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  const dest = path.join(
    process.env.TEMP || process.env.TMP || '.',
    `deprocast-ocr-${process.pid}-${Date.now()}.png`,
  )
  fs.writeFileSync(dest, canvas.toBuffer('image/png'))
  return dest
}

async function tryWindowsOcr(imageAbsPath: string): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const script = path.resolve(__dirname, '../../scripts/windows-ocr.ps1')
  if (!fs.existsSync(script)) return null
  let png: string | null = null
  try {
    png = await rasterizePng(imageAbsPath)
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-ImagePath',
        png,
      ],
      { timeout: 90_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    )
    const text = String(stdout || '').trim()
    if (text) return text
    const errOut = String(stderr || '').trim()
    if (errOut) {
      console.warn('[local-ocr] Windows OCR:', errOut.slice(0, 400))
    }
    return null
  } catch (err) {
    const extra = err && typeof err === 'object' && 'stderr' in err
      ? String((err as { stderr?: Buffer | string }).stderr || '')
      : ''
    console.warn(
      '[local-ocr] Windows OCR no disponible:',
      `${err instanceof Error ? err.message : err} ${extra}`.trim().slice(0, 400),
    )
    return null
  } finally {
    if (png) {
      try {
        fs.unlinkSync(png)
      } catch {
        /* ignore */
      }
    }
  }
}

export async function analyzeNotebookPageLocal(
  imageAbsPath: string,
): Promise<NotebookPageVisionResult | null> {
  const tess = await tryTesseractCli(imageAbsPath)
  if (tess) {
    console.log(
      `[local-ocr] tesseract ${path.basename(imageAbsPath)} → ${tess.length}c`,
    )
    return toResult(tess, 'ocr:tesseract')
  }
  const win = await tryWindowsOcr(imageAbsPath)
  if (win) {
    console.log(
      `[local-ocr] Windows OCR ${path.basename(imageAbsPath)} → ${win.length}c`,
    )
    return toResult(win, 'ocr:windows')
  }
  return null
}
