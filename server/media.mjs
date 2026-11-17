import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

export const ffmpeg = (args, signal) =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(
      process.env.FFMPEG_PATH || 'ffmpeg',
      ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args],
      { signal, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    child.stderr.resume()
    child.on('error', (e) =>
      reject(
        new Error(e.name === 'AbortError' ? '已取消' : '无法启动 FFmpeg，请安装或配置 FFMPEG_PATH')
      )
    )
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error('音频处理失败，请检查文件是否有效'))
    )
  })
export const splitAudio = async (file, dir, signal) => {
  await ffmpeg(
    [
      '-i',
      file.path,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-f',
      'segment',
      '-segment_time',
      '110',
      '-reset_timestamps',
      '1',
      path.join(dir, 'part-%04d.wav'),
    ],
    signal
  )
  const names = (await readdir(dir)).filter((n) => /^part-\d+\.wav$/.test(n)).sort()
  if (!names.length || names.length > 100) {
    throw new Error('录音为空或超过约 3 小时的处理上限')
  }
  return names.map((name) => ({ path: path.join(dir, name), name, mime: 'audio/wav' }))
}
export const wav = (pcm, sampleRate = 24000) => {
  if (!pcm.length || pcm.length % 2) {
    throw new Error('语音数据不完整')
  }
  const header = Buffer.alloc(44)
  header.write('RIFF')
  header.writeUInt32LE(pcm.length + 36, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
export const parseScript = (text) => {
  const lines = text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  if (!lines.length || lines.length > 80) {
    throw new Error('脚本需要 1～80 行，每行以 A: 或 B: 开头')
  }
  return lines.map((line) => {
    const match = /^([AB])[:：]\s*(.+)$/.exec(line)
    if (!match || [...match[2]].length > 1200) {
      throw new Error('每行需以 A: 或 B: 开头，单行不超过 1200 字')
    }
    return { role: match[1], text: match[2] }
  })
}
export const synthesizeScript = async (script, provider, signal, progress) => {
  const lines = parseScript(script),
    chunks = []
  for (let i = 0; i < lines.length; i++) {
    signal.throwIfAborted()
    progress(`合成语音 ${i + 1}/${lines.length}`)
    chunks.push(
      await provider.tts(lines[i].text, lines[i].role === 'A' ? 'stella' : 'tide', signal),
      Buffer.alloc(12000)
    )
  }
  return wav(Buffer.concat(chunks))
}
