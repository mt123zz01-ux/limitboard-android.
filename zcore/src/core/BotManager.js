const fs = require('node:fs')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { FileLogger } = require('./FileLogger')
const { BotSession, profileStaggerOffset } = require('./BotSession')

const ACTIVE_STATUSES = new Set(['connecting', 'online', 'reconnecting', 'authenticating'])
const LOG_CACHE_LIMIT = 100
const PROFILE_START_STAGGER_MS = 8_000
const WORKER_HEARTBEAT_TIMEOUT_MS = 30_000
const WORKER_MONITOR_INTERVAL_MS = 5_000
const WORKER_STALE_CHECK_LIMIT = 2
const WORKER_HEAP_LIMIT_MB = 128
// Repair 22 — mỗi worker mặc định giữ semi-space khá lớn. Bot AFK sinh rất ít
// object ngắn hạn nên hạ young generation giảm RSS thật cho mỗi account.
const WORKER_YOUNG_HEAP_LIMIT_MB = 8
const STATS_PERSIST_INTERVAL_MS = 10_000
const CONNECTION_FIELDS = [
  'host', 'port', 'microsoftAccount', 'proxyEnabled', 'proxyType',
  'proxyHost', 'proxyPort', 'proxyUsername', 'proxyPassword', 'workerEnabled',
  'afkLiteEnabled', 'clientEngine'
]

function offlineRuntime(profile) {
  return {
    profileId: profile.id,
    status: 'offline',
    username: null,
    autoSellState: 'IDLE',
    autoSellPaused: false,
    autoSellAxe: {
      enabled: profile.autoSellAxeEnabled === true,
      lookUpEnabled: profile.autoSellAxeLookUpEnabled !== false,
      running: false,
      leftClickHeld: false,
      lastSwingAt: null,
      lastLookCheckAt: null,
      lastLookCorrectionAt: null
    },
    autoHome: {
      enabled: profile.autoHomeEnabled === true,
      running: false,
      homeNumber: profile.autoHomeNumber || 1,
      delayMinutes: profile.autoHomeDelayMinutes || 5,
      nextSendAt: null,
      lastSentAt: null,
      waitingForSafeWindow: false
    },
    blockedByProtection: false,
    lastError: null,
    network: { connectedAt: null, lastPacketAt: null, packetCount: 0, failedAttempts: 0 },
    stats: profile.lastStats,
    balance: {
      amount: null,
      source: null,
      updatedAt: null,
      trackingEnabled: profile.balanceTrackingEnabled !== false,
      commandEnabled: profile.balanceCommandEnabled !== false,
      pollIntervalMs: profile.balanceTrackingEnabled !== false && profile.balanceCommandEnabled === false ? 5_000 : null,
      scoreboardPollingEnabled: profile.balanceTrackingEnabled !== false && profile.balanceCommandEnabled === false
    },
    workerHealth: null,
    clientEngine: profile.clientEngine === 'mineflayer' ? 'mineflayer' : 'protocol',
    executionMode: profile.workerEnabled === false ? 'main' : 'worker'
  }
}

class BotManager {
  constructor(profileStore, userDataDirectory, emit = () => {}, options = {}) {
    this.profileStore = profileStore
    this.emit = emit
    this.workers = new Map()
    this.directSessions = new Map()
    this.runtimes = new Map()
    this.logs = new Map()
    this.pendingStats = new Map()
    this.statsFlushTimer = null
    this.pendingStarts = new Map()
    this.restartTimers = new Map()
    this.desiredRunning = new Set()
    this.requestSequence = 0
    this.nextStartAt = 0
    this.resourceSavingMode = false
    this.WorkerClass = options.WorkerClass || Worker
    this.SessionClass = options.SessionClass || BotSession
    this.workerScript = options.workerScript || path.join(__dirname, 'BotWorker.js')
    this.requestTimeoutMs = options.requestTimeoutMs || 15_000
    this.startStaggerMs = options.startStaggerMs ?? PROFILE_START_STAGGER_MS
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? WORKER_HEARTBEAT_TIMEOUT_MS
    this.workerMonitorIntervalMs = options.workerMonitorIntervalMs ?? WORKER_MONITOR_INTERVAL_MS
    this.workerStaleCheckLimit = options.workerStaleCheckLimit ?? WORKER_STALE_CHECK_LIMIT
    this.workerHeapLimitMb = options.workerHeapLimitMb ?? WORKER_HEAP_LIMIT_MB
    this.workerYoungHeapLimitMb = options.workerYoungHeapLimitMb ?? WORKER_YOUNG_HEAP_LIMIT_MB
    this.authRoot = path.join(userDataDirectory, 'auth')
    this.logDirectory = path.join(userDataDirectory, 'logs')
    this.fileLogger = new FileLogger(this.logDirectory)
    fs.mkdirSync(this.authRoot, { recursive: true })
    this.workerMonitorTimer = setInterval(() => this.monitorWorkers(), this.workerMonitorIntervalMs)
    this.workerMonitorTimer.unref?.()
  }

  list() {
    return this.profileStore.list().map((profile) => ({
      profile,
      runtime: {
        ...(this.runtimes.get(profile.id) || offlineRuntime(profile)),
        logs: [...(this.logs.get(profile.id) || [])]
      }
    }))
  }

  create(input) {
    const profile = this.profileStore.create(input)
    this.emit('profiles-changed', this.list())
    return profile
  }

  duplicate(id) {
    const profile = this.profileStore.duplicate(id)
    this.emit('profiles-changed', this.list())
    return profile
  }

  async update(id, patch) {
    const previous = this.profileStore.get(id)
    if (!previous) throw new Error('Không tìm thấy profile')
    const normalizedPatch = { ...patch }
    if (patch.autoSellAxeEnabled === true && patch.autoSellEnabled !== true) {
      normalizedPatch.autoSellEnabled = false
    } else if (patch.autoSellEnabled === true && patch.autoSellAxeEnabled !== true) {
      normalizedPatch.autoSellAxeEnabled = false
    } else if (patch.autoSellAxeEnabled === true && patch.autoSellEnabled === true) {
      normalizedPatch.autoSellEnabled = false
    }
    const runtime = this.runtimes.get(id)
    const connectionChanged = CONNECTION_FIELDS.some((key) =>
      Object.prototype.hasOwnProperty.call(normalizedPatch, key) && normalizedPatch[key] !== previous[key]
    )
    if (connectionChanged && runtime && ACTIVE_STATUSES.has(runtime.status)) {
      throw new Error('Hãy Stop profile trước khi đổi kết nối hoặc chế độ worker')
    }

    const profile = this.profileStore.update(id, normalizedPatch)
    const modeChanged = previous.workerEnabled !== profile.workerEnabled
    if (modeChanged) {
      this.desiredRunning.delete(id)
      this.cancelPendingStart(id)
      this.clearRestartTimer(id)
      await this.shutdownWorker(id)
      this.shutdownDirectSession(id)
      this.runtimes.set(id, offlineRuntime(profile))
    } else if (this.workers.has(id)) {
      await this.command(id, 'apply-profile', { profile })
    } else {
      this.directSessions.get(id)?.applyProfile(profile)
    }
    this.emit('profiles-changed', this.list())
    return profile
  }

  async delete(id) {
    this.desiredRunning.delete(id)
    this.cancelPendingStart(id)
    this.clearRestartTimer(id)
    await this.shutdownWorker(id)
    this.shutdownDirectSession(id)
    this.runtimes.delete(id)
    this.logs.delete(id)
    this.clearStatsTimer(id)
    const removed = this.profileStore.delete(id)
    if (removed) {
      const target = path.resolve(this.authRoot, id)
      if (path.dirname(target) === path.resolve(this.authRoot)) {
        try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
      }
    }
    this.emit('profiles-changed', this.list())
    return removed
  }

  ensureWorker(id) {
    const existing = this.workers.get(id)
    if (existing) return existing
    const profile = this.profileStore.get(id)
    if (!profile) throw new Error('Không tìm thấy profile')

    const worker = new this.WorkerClass(this.workerScript, {
      workerData: {
        profile,
        authRoot: this.authRoot,
        logDirectory: this.logDirectory,
        headlessMode: this.resourceSavingMode
      },
      resourceLimits: {
        maxOldGenerationSizeMb: this.workerHeapLimitMb,
        maxYoungGenerationSizeMb: this.workerYoungHeapLimitMb
      }
    })
    const record = {
      worker,
      pending: new Map(),
      closing: false,
      failed: false,
      restarting: false,
      lastHeartbeatAt: Date.now(),
      staleChecks: 0,
      lastHealthEmitAt: 0,
      lastHealthState: null
    }
    this.workers.set(id, record)
    worker.on('message', (message) => this.handleWorkerMessage(id, record, message))
    worker.on('error', (error) => this.handleWorkerFailure(id, record, error))
    worker.on('exit', (code) => {
      const shouldRestart = !record.closing && this.desiredRunning.has(id)
      if (!record.closing && code !== 0) this.handleWorkerFailure(id, record, new Error(`Worker đã thoát với mã ${code}`))
      this.finishWorker(id, record)
      if (shouldRestart) this.scheduleWorkerRestart(id, `worker thoát mã ${code}`)
    })
    return record
  }

  ensureDirectSession(id) {
    const existing = this.directSessions.get(id)
    if (existing) return existing
    const profile = this.profileStore.get(id)
    if (!profile) throw new Error('Không tìm thấy profile')
    const session = new this.SessionClass(
      profile,
      this.authRoot,
      (type, payload) => {
        if (type === 'state') this.updateRuntime(id, payload)
        else if (type === 'log') this.appendLogs(id, [payload])
        else this.emit('bot-event', { profileId: id, type, payload })
      },
      (stats) => this.scheduleStatsPersist(id, stats),
      this.fileLogger
    )
    this.directSessions.set(id, session)
    session.resourceSavingMode = this.resourceSavingMode
    this.updateRuntime(id, session.snapshot(false), true)
    return session
  }

  handleWorkerMessage(id, record, message) {
    if (!message || record !== this.workers.get(id)) return
    if (message.type === 'ready') {
      record.lastHeartbeatAt = Date.now()
      record.staleChecks = 0
      const runtime = this.desiredRunning.has(id) && message.runtime?.status === 'offline'
        ? { ...message.runtime, status: 'connecting', queuedStart: true }
        : message.runtime
      this.updateRuntime(id, runtime, true)
      return
    }
    if (message.type === 'heartbeat') {
      record.lastHeartbeatAt = Number(message.at) || Date.now()
      record.staleChecks = 0
      const current = this.runtimes.get(id)
      if (current) {
        const heapLimitBytes = this.workerHeapLimitMb * 1024 * 1024
        const heapUsed = Number(message.health?.heapUsed) || 0
        const healthState = heapUsed > heapLimitBytes * 0.85 ? 'high' : 'healthy'
        const shouldEmit = !this.resourceSavingMode && (
          record.lastHealthState !== healthState ||
          record.lastHeartbeatAt - record.lastHealthEmitAt >= 30_000
        )
        record.lastHealthState = healthState
        if (shouldEmit) record.lastHealthEmitAt = record.lastHeartbeatAt
        this.updateRuntime(id, {
          ...current,
          workerHealth: {
            ...(message.health || {}),
            heapLimitBytes,
            lastHeartbeatAt: record.lastHeartbeatAt,
            state: healthState
          }
        }, !shouldEmit)
      }
      return
    }
    if (message.type === 'response') {
      const pending = record.pending.get(message.requestId)
      if (!pending) return
      record.pending.delete(message.requestId)
      clearTimeout(pending.timer)
      if (message.result?.runtime) this.updateRuntime(id, message.result.runtime, true)
      if (message.error) pending.reject(new Error(message.error.message || 'Worker lỗi'))
      else pending.resolve(message.result)
      return
    }
    if (message.type === 'persist-stats') {
      this.scheduleStatsPersist(id, message.stats)
      return
    }
    if (message.type !== 'event') return
    if (message.eventType === 'state') this.updateRuntime(id, message.payload)
    else if (message.eventType === 'log-batch') this.appendLogs(id, message.payload)
    else this.emit('bot-event', { profileId: id, type: message.eventType, payload: message.payload })
  }

  updateRuntime(id, runtime, quiet = false) {
    if (!runtime || typeof runtime !== 'object') return
    const sanitized = { ...runtime }
    delete sanitized.logs
    sanitized.executionMode = this.directSessions.has(id) ? 'main' : 'worker'
    this.runtimes.set(id, sanitized)
    if (!quiet) this.emit('bot-event', { profileId: id, type: 'state', payload: sanitized })
  }

  appendLogs(id, entries) {
    if (!Array.isArray(entries) || !entries.length) return
    const logs = this.logs.get(id) || []
    logs.push(...entries)
    if (logs.length > LOG_CACHE_LIMIT) logs.splice(0, logs.length - LOG_CACHE_LIMIT)
    this.logs.set(id, logs)
    this.emit('bot-event', { profileId: id, type: 'log-batch', payload: entries })
  }

  handleWorkerFailure(id, record, error) {
    if (record.failed || record.closing) return
    record.failed = true
    const message = error?.message || String(error)
    const profile = this.profileStore.get(id)
    this.updateRuntime(id, {
      ...(this.runtimes.get(id) || (profile ? offlineRuntime(profile) : {})),
      profileId: id,
      status: this.desiredRunning.has(id) ? 'reconnecting' : 'offline',
      lastError: message
    })
    this.appendLogs(id, [{ time: Date.now(), level: 'error', message: `Worker profile gặp lỗi: ${message}` }])
    this.fileLogger.write(id, 'error', 'Worker profile gặp lỗi', error)
  }

  finishWorker(id, record) {
    if (this.workers.get(id) === record) this.workers.delete(id)
    for (const pending of record.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Worker profile đã dừng'))
    }
    record.pending.clear()
  }

  waitForStartSlot(id) {
    const existing = this.pendingStarts.get(id)
    if (existing) return existing.promise
    const now = Date.now()
    const scheduledAt = Math.max(now, this.nextStartAt)
    this.nextStartAt = scheduledAt + Math.max(0, this.startStaggerMs)
    const delayMs = scheduledAt - now
    if (delayMs <= 0) return Promise.resolve(true)

    let resolveStart
    const promise = new Promise((resolve) => { resolveStart = resolve })
    const timer = setTimeout(() => {
      this.pendingStarts.delete(id)
      resolveStart(true)
    }, delayMs)
    timer.unref?.()
    this.pendingStarts.set(id, { timer, promise, resolve: resolveStart })
    return promise
  }

  cancelPendingStart(id) {
    const entry = this.pendingStarts.get(id)
    if (!entry) return false
    clearTimeout(entry.timer)
    this.pendingStarts.delete(id)
    entry.resolve(false)
    return true
  }

  clearRestartTimer(id) {
    const timer = this.restartTimers.get(id)
    if (timer) clearTimeout(timer)
    this.restartTimers.delete(id)
  }

  scheduleWorkerRestart(id, reason = 'worker không phản hồi', delayMs = null) {
    if (!this.desiredRunning.has(id) || this.restartTimers.has(id)) return
    const waitMs = delayMs ?? (1_000 + profileStaggerOffset(id, 2_500))
    this.appendLogs(id, [{
      time: Date.now(),
      level: 'warn',
      message: `Đang phục hồi riêng worker sau ${(waitMs / 1000).toFixed(1)} giây (${reason}).`
    }])
    const timer = setTimeout(async () => {
      this.restartTimers.delete(id)
      const profile = this.profileStore.get(id)
      if (!this.desiredRunning.has(id) || !profile || profile.workerEnabled === false) return
      try {
        await this.command(id, 'start')
      } catch (error) {
        this.appendLogs(id, [{ time: Date.now(), level: 'error', message: `Khởi động lại worker thất bại: ${error.message}` }])
        this.scheduleWorkerRestart(id, error.message, 5_000 + profileStaggerOffset(id, 2_500))
      }
    }, waitMs)
    timer.unref?.()
    this.restartTimers.set(id, timer)
  }

  monitorWorkers() {
    const now = Date.now()
    for (const [id, record] of this.workers) {
      if (record.closing || record.restarting || !this.desiredRunning.has(id)) continue
      if (now - record.lastHeartbeatAt <= this.heartbeatTimeoutMs) {
        record.staleChecks = 0
        continue
      }
      record.staleChecks += 1
      if (record.staleChecks < this.workerStaleCheckLimit) continue
      this.restartStalledWorker(id, record)
    }
  }

  async restartStalledWorker(id, record) {
    if (record !== this.workers.get(id) || record.restarting || !this.desiredRunning.has(id)) return
    record.restarting = true
    record.closing = true
    const current = this.runtimes.get(id)
    if (current) this.updateRuntime(id, { ...current, status: 'reconnecting', workerHealth: { ...(current.workerHealth || {}), state: 'stalled' } })
    this.appendLogs(id, [{ time: Date.now(), level: 'error', message: 'Worker không phản hồi heartbeat; chỉ khởi động lại account này.' }])
    try { await record.worker.terminate() } catch {}
    this.finishWorker(id, record)
    this.scheduleWorkerRestart(id, 'heartbeat bị treo')
  }

  command(id, action, payload = null) {
    const record = this.ensureWorker(id)
    const requestId = `${id}:${++this.requestSequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        record.pending.delete(requestId)
        reject(new Error(`Worker không phản hồi lệnh ${action}`))
      }, this.requestTimeoutMs)
      timer.unref?.()
      record.pending.set(requestId, { resolve, reject, timer })
      try {
        record.worker.postMessage({ type: 'command', action, payload, requestId })
      } catch (error) {
        clearTimeout(timer)
        record.pending.delete(requestId)
        reject(error)
      }
    })
  }

  async start(id) {
    const profile = this.profileStore.get(id)
    if (!profile) throw new Error('Không tìm thấy profile')
    this.desiredRunning.add(id)
    this.clearRestartTimer(id)
    const queuedRuntime = this.runtimes.get(id) || offlineRuntime(profile)
    this.updateRuntime(id, { ...queuedRuntime, status: 'connecting', queuedStart: true })
    const proceed = await this.waitForStartSlot(id)
    if (!proceed || !this.desiredRunning.has(id)) return this.list()
    try {
      const currentProfile = this.profileStore.get(id)
      if (!currentProfile) throw new Error('Không tìm thấy profile')
      if (currentProfile.workerEnabled === false) this.ensureDirectSession(id).start()
      else await this.command(id, 'start')
    } catch (error) {
      this.desiredRunning.delete(id)
      throw error
    }
    return this.list()
  }

  async stop(id) {
    this.desiredRunning.delete(id)
    this.clearRestartTimer(id)
    if (this.cancelPendingStart(id)) {
      const profile = this.profileStore.get(id)
      if (profile) this.updateRuntime(id, offlineRuntime(profile))
      return this.list()
    }
    const direct = this.directSessions.get(id)
    if (direct) {
      this.shutdownDirectSession(id)
    } else if (this.workers.has(id)) {
      const record = this.workers.get(id)
      try {
        const result = await this.command(id, 'stop')
        if (result?.runtime?.stats) this.persistStatsNow(id, result.runtime.stats)
        if (record === this.workers.get(id)) await this.shutdownWorker(id)
      } catch (error) {
        record.closing = true
        try { await record.worker.terminate() } catch {}
        this.finishWorker(id, record)
        const profile = this.profileStore.get(id)
        if (profile) this.updateRuntime(id, { ...offlineRuntime(profile), lastError: `Đã buộc giải phóng worker: ${error.message}` })
      }
    }
    return this.list()
  }

  async resetStats(id) {
    const profile = this.profileStore.get(id)
    if (!profile) throw new Error('Không tìm thấy profile')
    if (this.directSessions.has(id)) this.directSessions.get(id).resetStats()
    else if (this.workers.has(id)) await this.command(id, 'reset-stats')
    else {
      const stats = {
        totalEarned: 0,
        totalSalesCount: 0,
        elapsedMs: 0,
        earnedPerHour: 0,
        startedAt: null,
        stoppedAt: null
      }
      this.persistStatsNow(id, stats)
      this.updateRuntime(id, { ...offlineRuntime(this.profileStore.get(id)), stats })
    }
    return this.list()
  }

  async sendChat(id, text) {
    const direct = this.directSessions.get(id)
    if (direct) direct.sendChat(text)
    else if (this.workers.has(id)) await this.command(id, 'send-chat', { text })
    else throw new Error('Bot chưa online')
    return true
  }

  async setResourceSavingMode(enabled) {
    this.resourceSavingMode = enabled === true
    for (const session of this.directSessions.values()) session.setResourceSavingMode(this.resourceSavingMode)
    const updates = []
    for (const id of this.workers.keys()) {
      updates.push(this.command(id, 'set-resource-saving', { enabled: this.resourceSavingMode }))
    }
    await Promise.allSettled(updates)
    return true
  }

  scheduleStatsPersist(id, stats) {
    if (!stats || !this.profileStore.get(id)) return
    this.pendingStats.set(id, stats)
    if (this.statsFlushTimer) return
    this.statsFlushTimer = setTimeout(() => this.flushPendingStats(), STATS_PERSIST_INTERVAL_MS)
    this.statsFlushTimer.unref?.()
  }

  flushPendingStats() {
    if (this.statsFlushTimer) clearTimeout(this.statsFlushTimer)
    this.statsFlushTimer = null
    if (!this.pendingStats.size) return
    const entries = [...this.pendingStats].map(([id, stats]) => ({ id, patch: { lastStats: stats } }))
    this.pendingStats.clear()
    try { this.profileStore.updateMany(entries) } catch {}
  }

  persistStatsNow(id, stats) {
    if (!stats || !this.profileStore.get(id)) return
    this.pendingStats.delete(id)
    if (!this.pendingStats.size && this.statsFlushTimer) {
      clearTimeout(this.statsFlushTimer)
      this.statsFlushTimer = null
    }
    try { this.profileStore.update(id, { lastStats: stats }) } catch {}
  }

  clearStatsTimer(id) {
    this.pendingStats.delete(id)
    if (!this.pendingStats.size && this.statsFlushTimer) {
      clearTimeout(this.statsFlushTimer)
      this.statsFlushTimer = null
    }
  }

  async shutdownWorker(id) {
    const record = this.workers.get(id)
    if (!record) return
    record.closing = true
    try {
      const result = await this.command(id, 'shutdown')
      if (result?.runtime?.stats) this.persistStatsNow(id, result.runtime.stats)
    } catch {}
    try { await record.worker.terminate() } catch {}
    this.finishWorker(id, record)
  }

  shutdownDirectSession(id) {
    const session = this.directSessions.get(id)
    if (!session) return
    session.stop()
    const runtime = session.snapshot(false)
    if (runtime?.stats) this.persistStatsNow(id, runtime.stats)
    this.directSessions.delete(id)
  }

  stopAll() {
    if (this.workerMonitorTimer) clearInterval(this.workerMonitorTimer)
    this.workerMonitorTimer = null
    this.desiredRunning.clear()
    this.flushPendingStats()
    for (const id of [...this.pendingStarts.keys()]) this.cancelPendingStart(id)
    for (const id of [...this.restartTimers.keys()]) this.clearRestartTimer(id)
    for (const [id, session] of this.directSessions) {
      session.stop()
      const runtime = session.snapshot(false)
      if (runtime?.stats) this.persistStatsNow(id, runtime.stats)
    }
    this.directSessions.clear()
    for (const [id, record] of this.workers) {
      const runtime = this.runtimes.get(id)
      if (runtime?.stats) this.persistStatsNow(id, runtime.stats)
      record.closing = true
      try { record.worker.postMessage({ type: 'command', action: 'shutdown', requestId: null }) } catch {}
      const timer = setTimeout(() => record.worker.terminate().catch(() => {}), 1000)
      timer.unref?.()
    }
  }
}

module.exports = {
  BotManager,
  offlineRuntime,
  ACTIVE_STATUSES,
  CONNECTION_FIELDS,
  LOG_CACHE_LIMIT,
  PROFILE_START_STAGGER_MS,
  WORKER_HEARTBEAT_TIMEOUT_MS,
  WORKER_MONITOR_INTERVAL_MS,
  WORKER_STALE_CHECK_LIMIT,
  WORKER_HEAP_LIMIT_MB,
  WORKER_YOUNG_HEAP_LIMIT_MB,
  STATS_PERSIST_INTERVAL_MS
}
