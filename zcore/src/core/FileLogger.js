const fs = require('node:fs')
const path = require('node:path')
const FLUSH_INTERVAL_MS = 2_000
const FLUSH_THRESHOLD_BYTES = 64 * 1024

function safeName(value) {
  return String(value || 'system').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'system'
}

class FileLogger {
  constructor(directory) {
    this.directory = directory
    this.files = new Map()
    fs.mkdirSync(directory, { recursive: true })
  }

  flushFile(file, entry) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    if (!entry.lines.length) return entry.writing
    const contents = `${entry.lines.splice(0).join('\n')}\n`
    entry.bytes = 0
    entry.writing = entry.writing
      .catch(() => {})
      .then(() => fs.promises.appendFile(file, contents, { encoding: 'utf8', mode: 0o600 }))
    return entry.writing
  }

  write(profileId, level, message, error = null) {
    try {
      const day = new Date().toISOString().slice(0, 10)
      const file = path.join(this.directory, `${day}-${safeName(profileId)}.log`)
      const details = error?.stack || error?.message || ''
      const line = [
        new Date().toISOString(),
        String(level || 'info').toUpperCase(),
        String(message || '').replace(/[\r\n]+/g, ' '),
        details ? String(details).replace(/[\r\n]+/g, ' → ') : ''
      ].filter(Boolean).join(' | ')
      let entry = this.files.get(file)
      if (!entry) {
        entry = { lines: [], bytes: 0, timer: null, writing: Promise.resolve() }
        this.files.set(file, entry)
      }
      entry.lines.push(line)
      entry.bytes += Buffer.byteLength(line, 'utf8') + 1
      if (entry.bytes >= FLUSH_THRESHOLD_BYTES) this.flushFile(file, entry).catch(() => {})
      else if (!entry.timer) {
        entry.timer = setTimeout(() => this.flushFile(file, entry).catch(() => {}), FLUSH_INTERVAL_MS)
        entry.timer.unref?.()
      }
      return file
    } catch {
      return null
    }
  }

  async flush() {
    const operations = []
    for (const [file, entry] of this.files) operations.push(this.flushFile(file, entry))
    await Promise.allSettled(operations)
    const trailing = []
    for (const [file, entry] of this.files) {
      if (entry.lines.length) trailing.push(this.flushFile(file, entry))
    }
    await Promise.allSettled(trailing)
  }
}

module.exports = { FileLogger, safeName, FLUSH_INTERVAL_MS, FLUSH_THRESHOLD_BYTES }
