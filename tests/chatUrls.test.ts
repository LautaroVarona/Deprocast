import { describe, expect, it } from 'vitest'
import {
  composeChatLinks,
  extractUrlsFromMessages,
  extractUrlsFromText,
  mergeUrlLists,
} from '../shared/chatUrls.ts'

describe('chatUrls', () => {
  it('extrae URLs del hilo y mergea con las guardadas', () => {
    const text =
      'mirá https://carteles-va.example/x y https://www.instagram.com/reel/abc/.'
    expect(extractUrlsFromText(text)).toEqual([
      'https://carteles-va.example/x',
      'https://www.instagram.com/reel/abc/',
    ])
    const merged = composeChatLinks(
      [
        { texto_crudo: 'https://a.example/1' },
        { texto_crudo: 'sin links' },
        { texto_crudo: 'otro https://a.example/1 y https://b.example/2' },
      ],
      ['https://guardado.example/z'],
    )
    expect(merged).toEqual([
      'https://guardado.example/z',
      'https://a.example/1',
      'https://b.example/2',
    ])
    expect(extractUrlsFromMessages([{ texto_crudo: null }])).toEqual([])
    expect(
      mergeUrlLists('https://a.example\nhttps://b.example', [
        'https://a.example',
      ]),
    ).toEqual(['https://a.example', 'https://b.example'])
  })
})
