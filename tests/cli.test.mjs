import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)

test('stop only shuts down the registered SeekStudio launch', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'seek-cli-test-'))
  const pidFile = path.join(dir, '.seek-studio', 'server.pid')
  const cli = (command) => exec(process.execPath, ['server/cli.mjs', command], { cwd: dir })
  let child
  let exited
  try {
    await mkdir(path.join(dir, 'server'))
    await mkdir(path.dirname(pidFile))
    for (const file of ['cli.mjs', 'cli-control.mjs']) {
      await copyFile(new URL(`../server/${file}`, import.meta.url), path.join(dir, 'server', file))
    }
    child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { createServer } from 'node:http'
         import { once } from 'node:events'
         import { registerCliService } from './server/cli-control.mjs'
         const app = createServer().listen(0, '127.0.0.1')
         process.on('SIGTERM', () => app.close())
         await once(app, 'listening')
         await registerCliService(app)
         console.log('ready')`,
      ],
      {
        cwd: dir,
        env: { ...process.env, SEEK_STUDIO_CLI_TOKEN: randomBytes(32).toString('hex') },
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    )
    exited = once(child, 'exit')
    await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) })
    const record = JSON.parse(await readFile(pidFile, 'utf8'))

    await writeFile(pidFile, String(child.pid))
    assert.match((await cli('stop')).stdout, /没有已登记/)
    assert.equal(child.signalCode, null)

    await writeFile(pidFile, JSON.stringify({ ...record, token: randomBytes(32).toString('hex') }))
    assert.match((await cli('stop')).stdout, /没有已登记/)

    await writeFile(pidFile, JSON.stringify(record))
    assert.match((await cli('status')).stdout, new RegExp(`PID: ${child.pid}\\b`))
    assert.match((await cli('stop')).stdout, /已停止/)
    assert.deepEqual(await exited, [0, null])
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill()
    }
    await exited
    await rm(dir, { recursive: true, force: true })
  }
})
