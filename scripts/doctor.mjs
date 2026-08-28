import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const home = os.homedir()
let failed = 0

function ok(label, cond, hint) {
  if (cond) {
    console.log(`ok   ${label}`)
    return
  }
  failed++
  console.error(`fail ${label}${hint ? ` — ${hint}` : ''}`)
}

const [major, minor] = process.versions.node.split('.').map(Number)
ok(
  `Node ${process.versions.node} (>=22.5)`,
  major > 22 || (major === 22 && minor >= 5),
  'set PATH=%USERPROFILE%\\bin\\node-v24.18.0-win-x64;%PATH%',
)

ok('package.json', fs.existsSync(path.join(root, 'package.json')))
ok('.env.example', fs.existsSync(path.join(root, '.env.example')))

function which(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8', windowsHide: true })
  return r.status === 0 || /ffmpeg|yt-dlp/i.test(r.stdout + r.stderr + (r.error?.message || ''))
}

const ffmpeg =
  fs.existsSync(path.join(root, 'tools', 'ffmpeg.exe')) ||
  fs.existsSync(path.join(home, 'bin', 'ffmpeg.exe')) ||
  which('ffmpeg')
ok('ffmpeg', ffmpeg, 'poné ffmpeg en tools/ o PATH')

const ytdlp =
  fs.existsSync(path.join(root, 'tools', 'yt-dlp.exe')) ||
  fs.existsSync(path.join(home, 'bin', 'yt-dlp.exe')) ||
  which('yt-dlp')
ok('yt-dlp', ytdlp, 'opcional para Instagram')

process.exit(failed ? 1 : 0)
