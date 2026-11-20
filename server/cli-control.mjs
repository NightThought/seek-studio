import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const cliHost = '127.0.0.1'
export const cliStateDir = fileURLToPath(new URL('../.seek-studio', import.meta.url))
const pidFile = path.join(cliStateDir, 'server.pid')
const tokenPattern = /^[a-f0-9]{64}$/
const pidHeader = 'x-seek-studio-pid'

export async function readCliService() {
  try {
    const service = JSON.parse(await readFile(pidFile, 'utf8'))
    if (
      Number.isSafeInteger(service?.pid) &&
      service.pid > 0 &&
      Number.isInteger(service.port) &&
      service.port > 0 &&
      service.port <= 65535 &&
      typeof service.token === 'string' &&
      tokenPattern.test(service.token)
    ) {
      return service
    }
  } catch {
    // A missing or unreadable record cannot establish ownership.
  }
  return null
}

export async function requestCliService(service, method = 'GET') {
  if (!service) {
    return false
  }
  try {
    const response = await fetch(`http://${cliHost}:${service.port}/`, {
      method,
      headers: { Authorization: `Bearer ${service.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(500),
    })
    return response.status === 204 && response.headers.get(pidHeader) === String(service.pid)
  } catch {
    return false
  }
}

export async function registerCliService(appServer) {
  const token = process.env.SEEK_STUDIO_CLI_TOKEN
  if (!tokenPattern.test(token ?? '')) {
    return
  }
  let stopping = false
  const control = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end()
      return
    }
    if (request.method === 'POST' && !stopping) {
      stopping = true
      response.once('finish', () => process.emit('SIGTERM', 'SIGTERM'))
    }
    response.writeHead(204, { [pidHeader]: String(process.pid) }).end()
  })

  const temp = `${pidFile}.${randomUUID()}.tmp`
  try {
    control.listen(0, cliHost)
    await once(control, 'listening')
    if (!appServer.listening) {
      control.close()
      return
    }
    control.unref()
    appServer.once('close', () => control.close())
    // Publish only after the app owns its HTTP port. An unsuccessful parallel launch never replaces this record.
    const record = { pid: process.pid, port: control.address().port, token }
    writeFileSync(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
    renameSync(temp, pidFile)
  } catch (error) {
    if (control.listening) {
      control.close()
    }
    throw error
  } finally {
    rmSync(temp, { force: true })
  }
}
