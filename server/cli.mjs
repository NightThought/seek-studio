import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { cliHost as host, cliStateDir, readCliService, requestCliService } from './cli-control.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logFile = path.join(cliStateDir, 'server.log')
const port = 8090
const address = `http://${host}:${port}/`
const rspackBin = path.join(root, 'node_modules/@rspack/cli/bin/rspack.js')
const serverArgs = ['--env-file-if-exists=.env', rspackBin, 'serve', '-c', 'rspack.config.ts']
const print = (text) => process.stdout.write(`${text}\n`)
const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

const currentService = async () => {
  const service = await readCliService()
  return (await requestCliService(service)) ? service : null
}

const isPortOpen = () =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (open) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })

const stopService = async (service) => {
  if (!(await requestCliService(service, 'POST'))) {
    return false
  }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (!(await requestCliService(service))) {
      return true
    }
    await delay(100)
  }
  return false
}

const stopServer = async () => {
  const service = await currentService()
  if (!service) {
    print('当前没有已登记的 SeekStudio 服务。')
  } else if (await stopService(service)) {
    print(`✔ 已停止 SeekStudio 服务（PID: ${service.pid}）`)
  } else {
    fail('✖ 未能确认 SeekStudio 已停止，请查看服务日志。')
  }
}

const launchServer = (token, options) =>
  spawn(process.execPath, serverArgs, {
    ...options,
    cwd: root,
    env: { ...process.env, SEEK_STUDIO_CLI_TOKEN: token },
  })

const startBackground = async (token) => {
  const out = openSync(logFile, 'a', 0o600)
  const child = launchServer(token, { detached: true, stdio: ['ignore', out, out] })
  closeSync(out)
  let spawnFailed = false
  child.on('error', () => {
    spawnFailed = true
  })
  child.unref()

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) {
      fail(`✖ 启动失败，请查看日志：${logFile}`)
      return
    }
    const service = await readCliService()
    if (service?.token === token && (await requestCliService(service))) {
      print(`✔ SeekStudio 已在后台启动（PID: ${service.pid}）`)
      print(`  ➜ 访问地址：${address}`)
      print(`  ➜ 日志文件：${logFile}`)
      print('  ➜ 停止命令：pnpm stop')
      return
    }
    await delay(100)
  }
  print(`SeekStudio 正在后台启动，可用 pnpm status 查看。日志：${logFile}`)
}

const startForeground = (token) => {
  const child = launchServer(token, { stdio: 'inherit' })
  child.on('error', (error) => fail(`✖ 无法启动 SeekStudio：${error.message}`))
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (!child.killed && child.exitCode === null && child.signalCode === null) {
        child.kill(sig)
      }
    })
  }
  child.on('exit', (code) => {
    process.exitCode = code ?? 0
  })
}

const startServer = async (background) => {
  const service = await currentService()
  if (service && background) {
    print(`✔ SeekStudio 已在运行（PID: ${service.pid}）：${address}`)
    return
  }
  if (service) {
    print(`检测到运行中的实例（PID: ${service.pid}），正在切换为前台启动…`)
    if (!(await stopService(service))) {
      fail('✖ 未能确认原实例已停止。')
      return
    }
  }
  if (await isPortOpen()) {
    print(`端口 ${port} 已有服务在运行：${address}`)
    return
  }
  await mkdir(cliStateDir, { recursive: true })
  const token = randomBytes(32).toString('hex')
  if (background) {
    await startBackground(token)
  } else {
    startForeground(token)
  }
}

const showStatus = async () => {
  const service = await currentService()
  if (service || (await isPortOpen())) {
    print(`✔ SeekStudio 正在运行${service ? `（PID: ${service.pid}）` : ''}：${address}`)
    if (service) {
      print(`  日志文件：${logFile}`)
    }
  } else {
    print('SeekStudio 当前未运行。可使用 pnpm start（前台）或 pnpm start:bg（后台）启动。')
  }
}

const args = new Set(process.argv.slice(2))
if (args.has('stop') || args.has('--stop')) {
  await stopServer()
} else if (args.has('status') || args.has('--status')) {
  await showStatus()
} else {
  await startServer(['bg', '--bg', 'daemon', '-d'].some((arg) => args.has(arg)))
}
