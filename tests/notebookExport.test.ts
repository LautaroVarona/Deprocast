import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assembleNotebookJsonDocument,
  notebookExportBasename,
  pageFolderName,
  pageHasExportContent,
  readExportImage,
} from '../server/services/notebookExport.ts'

const tmpFiles: string[] = []

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f)
    } catch {
      /* ignore */
    }
  }
  tmpFiles.length = 0
})

describe('pageHasExportContent', () => {
  const empty = {
    image_path: null as string | null,
    title: null as string | null,
    transcription_spatial: null as string | null,
    explanation: null as string | null,
    entry_id: null as string | null,
    quantomo_id: null as string | null,
  }

  it('rechaza hojas vacías', () => {
    expect(pageHasExportContent(empty)).toBe(false)
    expect(pageHasExportContent({ ...empty, title: '   ' })).toBe(false)
  })

  it('acepta imagen, texto o puente al corpus', () => {
    expect(pageHasExportContent({ ...empty, image_path: 'vault/x.png' })).toBe(
      true,
    )
    expect(pageHasExportContent({ ...empty, title: 'Tapa' })).toBe(true)
    expect(
      pageHasExportContent({ ...empty, transcription_spatial: 'hola' }),
    ).toBe(true)
    expect(pageHasExportContent({ ...empty, explanation: 'porque' })).toBe(true)
    expect(pageHasExportContent({ ...empty, entry_id: 'e1' })).toBe(true)
    expect(pageHasExportContent({ ...empty, quantomo_id: 'q1' })).toBe(true)
  })
})

describe('nombres de export', () => {
  it('arma carpeta de hoja con slot y etiqueta', () => {
    expect(pageFolderName({ slot_index: 0 })).toBe('000_tapa')
    expect(pageFolderName({ slot_index: 2 })).toMatch(/^002_/)
  })

  it('slugifica el título del cuaderno en el basename', () => {
    const name = notebookExportBasename({ title: 'Cuaderno Áureo!' })
    expect(name).toMatch(/^cuaderno-cuaderno-aureo-\d{4}-\d{2}-\d{2}$/)
  })
})

describe('readExportImage', () => {
  it('devuelve null si no hay archivo', () => {
    expect(readExportImage(null)).toBe(null)
    expect(readExportImage('no-existe-xyz.png')).toBe(null)
  })

  it('embebe bytes en base64 con mime según extensión', () => {
    const file = path.join(os.tmpdir(), `nb-export-${Date.now()}.jpg`)
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    tmpFiles.push(file)
    const img = readExportImage(file)
    expect(img?.mime).toBe('image/jpeg')
    expect(img?.encoding).toBe('base64')
    expect(img?.data).toBe(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'))
  })
})

describe('assembleNotebookJsonDocument', () => {
  it('deja un JSON parseable con todas las hojas en un solo documento', () => {
    const raw = assembleNotebookJsonDocument(
      {
        source: 'deprocast-biblioteca',
        format: 'json',
        notebook: { id: 'n1', title: 'Demo' },
      },
      [
        {
          slot_index: 0,
          numero_logico: 0,
          posicion_visual: 'Tapa',
          label: 'Tapa',
          status: 'Validada',
          title: 'Tapa',
          transcription_spatial: 'hola',
          explanation: null,
          explanation_user: null,
          explanation_ai: null,
          explanation_weight: null,
          graphic_elements: [],
          mentioned_entities: [],
          is_blank: 0,
          entry_id: null,
          quantomo_id: null,
          vision_meta: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          corpus: null,
          image: { mime: 'image/png', encoding: 'base64', data: 'QQ==' },
        },
      ],
    )
    const doc = JSON.parse(raw) as {
      format: string
      pages: Array<{ title: string; image: { data: string } }>
    }
    expect(doc.format).toBe('json')
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].title).toBe('Tapa')
    expect(doc.pages[0].image.data).toBe('QQ==')
  })
})
