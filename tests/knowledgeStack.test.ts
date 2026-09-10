import { describe, expect, it } from 'vitest'
import {
  detectStackTags,
  parseGithubRepoRef,
  pulseFromRepo,
  stripReadmeChrome,
} from '../server/services/knowledgeStack.ts'

describe('parseGithubRepoRef', () => {
  it('acepta URL https, git y owner/repo', () => {
    expect(parseGithubRepoRef('https://github.com/foo/bar')?.url).toBe(
      'https://github.com/foo/bar',
    )
    expect(parseGithubRepoRef('https://github.com/foo/bar.git')?.repo).toBe('bar')
    expect(parseGithubRepoRef('foo/bar')).toEqual({
      owner: 'foo',
      repo: 'bar',
      url: 'https://github.com/foo/bar',
    })
    expect(parseGithubRepoRef('github.com/acme/next.js/tree/main')?.repo).toBe(
      'next.js',
    )
  })

  it('rechaza basura', () => {
    expect(parseGithubRepoRef('https://gitlab.com/foo/bar')).toBeNull()
    expect(parseGithubRepoRef('https://github.com/foo')).toBeNull()
    expect(parseGithubRepoRef('')).toBeNull()
  })
})

describe('detectStackTags', () => {
  it('taggea Next, Tailwind, FFmpeg y Whisper desde manifiestos', () => {
    const tags = detectStackTags({
      files: {
        'package.json': JSON.stringify({
          dependencies: {
            next: '15.0.0',
            tailwindcss: '3.4.0',
            'fluent-ffmpeg': '2.1.0',
          },
        }),
        'requirements.txt': 'faster-whisper==1.0.0\nflask==3.0.0\n',
      },
    })
    expect(tags).toEqual(
      expect.arrayContaining([
        'nextjs',
        'tailwind',
        'ffmpeg',
        'whisper',
        'node',
        'python',
        'flask',
      ]),
    )
  })

  it('lee topics y Dockerfile', () => {
    const tags = detectStackTags({
      files: { Dockerfile: 'RUN apt-get install -y ffmpeg' },
      topics: ['whisper', 'rust'],
      languages: { Rust: 1200 },
    })
    expect(tags).toEqual(expect.arrayContaining(['ffmpeg', 'whisper', 'rust', 'docker']))
  })
})

describe('pulseFromRepo', () => {
  const now = Date.parse('2026-09-10T00:00:00.000Z')

  it('marca vivo, tibio y abandonado', () => {
    expect(
      pulseFromRepo({ last_commit_at: '2026-08-01T00:00:00.000Z', now }),
    ).toBe('vivo')
    expect(
      pulseFromRepo({ last_commit_at: '2024-01-01T00:00:00.000Z', now }),
    ).toBe('tibio')
    expect(
      pulseFromRepo({ last_commit_at: '2020-01-01T00:00:00.000Z', now }),
    ).toBe('abandonado')
    expect(pulseFromRepo({ archived: 1, last_commit_at: '2026-08-01', now })).toBe(
      'abandonado',
    )
  })
})

describe('stripReadmeChrome', () => {
  it('saca badges e imágenes y deja prosa', () => {
    const md = stripReadmeChrome(
      '<!-- logo -->\n[![ci](https://img.shields.io/ci)](https://ci)\n![](logo.png)\n# Hola\n\nArquitectura en tres capas.\n',
    )
    expect(md).toContain('Arquitectura en tres capas')
    expect(md).not.toMatch(/shields/)
    expect(md).not.toMatch(/logo\.png/)
  })
})
