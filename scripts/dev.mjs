/**
 * Arranca API (Express :3001) + Vite (:5173) juntos.
 * Si el Node del PATH es < 22.5, reintenta con el portable v24 en ~/bin.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const self = fileURLToPath(import.meta.url)
const require = createRequire(import.meta.url)
const isWin = process.platform === 'win32'
const home = os.homedir()

function hasNodeSqlite() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 5)) return false
  try {
    require('node:sqlite')
    return true
  } catch {
    return false
  }
}

function findPortableNode() {
  const names = isWin
    ? ['node-v24.18.0-win-x64', 'node-v24.18.0-x64']
    : ['node-v24.18.0-linux-x64']
  const candidates = []
  for (const name of names) {
    candidates.push(
      isWin
        ? path.join(home, 'bin', name, 'node.exe')
        : path.join(home, 'bin', name, 'bin', 'node'),
    )
  }
  if (isWin) {
    candidates.push('C:\\Users\\Lautaro.Sarni\\bin\\node-v24.18.0-win-x64\\node.exe')
  }
  try {
    const binDir = path.join(home, 'bin')
    for (const entry of fs.readdirSync(binDir)) {
      if (!entry.startsWith('node-v24')) continue
      candidates.push(
        isWin
          ? path.join(binDir, entry, 'node.exe')
          : path.join(binDir, entry, 'bin', 'node'),
      )
    }
  } catch {
    /* ~/bin puede no existir */
  }
  return candidates.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

function printNeedNode24() {
  console.error(`[dev] Node ${process.versions.node} no sirve: el server usa node:sqlite (Node 22.5+).`)
  console.error('[dev] Sin la API en :3001, Vite responde HTTP 500 / ECONNREFUSED en /api/*.')
  if (isWin) {
    console.error(
      '[dev] Poné Node 24 en el PATH, p.ej. set PATH=C:\\Users\\Lautaro.Sarni\\bin\\node-v24.18.0-win-x64;%PATH%',
    )
  } else {
    console.error(
      '[dev] Poné Node 24 en el PATH, p.ej. export PATH="$HOME/bin/node-v24.18.0-linux-x64/bin:$PATH"',
    )
  }
}

function reexec(nodeBin) {
  const nodeDir = path.dirname(nodeBin)
  console.log(`[dev] Node ${process.versions.node} → ${nodeBin}`)
  const child = spawn(nodeBin, [self, ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${nodeDir}${path.delimiter}${process.env.PATH || ''}`,
      DEPROCAST_NODE_REEXEC: '1',
    },
  })
  const forward = (sig) => {
    try {
      child.kill(sig)
    } catch {
      /* ignore */
    }
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1)
    process.exit(code ?? 0)
  })
}

if (!hasNodeSqlite()) {
  const portable = process.env.DEPROCAST_NODE_REEXEC === '1' ? null : findPortableNode()
  if (portable) {
    reexec(portable)
  } else {
    printNeedNode24()
    process.exit(1)
  }
} else {
  const bin = (name) =>
    path.join(root, 'node_modules', '.bin', isWin ? `${name}.cmd` : name)

  const children = []

  function run(label, cmd, args) {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: isWin,
      env: process.env,
    })
    child.on('exit', (code, signal) => {
      if (signal) return
      if (code && code !== 0) {
        console.error(`[dev] ${label} salió con código ${code}`)
        shutdown(code)
      }
    })
    children.push(child)
    return child
  }

  function shutdown(code = 0) {
    for (const child of children) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    process.exit(code)
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  async function waitForHealth(port, timeoutMs = 25000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`)
        if (res.ok) return true
      } catch {
        /* Express todavía no escucha */
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  }

  console.log(`[dev] Node ${process.version}  |  API → http://127.0.0.1:3001  |  UI → http://localhost:5173`)
  run('server', bin('tsx'), ['watch', 'server/index.ts'])
  const ready = await waitForHealth(3001)
  if (!ready) {
    console.warn('[dev] API no respondió a /api/health; Vite arranca igual')
  }
  run('vite', bin('vite'), [])
}
