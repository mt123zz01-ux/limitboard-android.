const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { ProfileStore } = require('../src/core/ProfileStore')
const { BotManager, offlineRuntime, PROFILE_START_STAGGER_MS } = require('../src/core/BotManager')

class FakeWorker extends EventEmitter {
  constructor(_script, options) {
    super()
    this.options = options
    this.profile = options.workerData.profile
    this.runtime = offlineRuntime(this.profile)
    queueMicrotask(() => this.emit('message', { type: 'ready', runtime: this.runtime }))
  }

  postMessage(message) {
    if (message.action === 'start') this.runtime = { ...this.runtime, status: 'online', username: this.profile.name }
    if (message.action === 'stop' || message.action === 'shutdown') this.runtime = { ...this.runtime, status: 'offline' }
    if (message.action === 'apply-profile') this.profile = message.payload.profile
    if (message.action === 'set-resource-saving') this.resourceSavingMode = message.payload.enabled
    queueMicrotask(() => {
      this.emit('message', { type: 'event', eventType: 'state', payload: this.runtime })
      if (message.requestId) this.emit('message', { type: 'response', requestId: message.requestId, result: { runtime: this.runtime } })
      if (message.action === 'shutdown') this.emit('exit', 0)
    })
  }

  async terminate() {
    this.emit('exit', 0)
    return 0
  }
}

class FakeSession {
  constructor(profile, _authRoot, emit) {
    this.profile = profile
    this.emit = emit
    this.status = 'offline'
  }

  snapshot() {
    return {
      ...offlineRuntime(this.profile),
      status: this.status,
      username: this.status === 'online' ? this.profile.name : null
    }
  }

  start() {
    this.status = 'online'
    this.emit('state', this.snapshot())
  }

  stop() {
    this.status = 'offline'
    this.emit('state', this.snapshot())
  }

  resetStats() { this.emit('state', this.snapshot()) }
  sendChat() {
    if (this.status !== 'online') throw new Error('Bot chưa online')
  }
  setResourceSavingMode(enabled) { this.resourceSavingMode = enabled }
  applyProfile(profile) { this.profile = profile }
}

test('mặc định giãn Start 8 giây để nhiều account không tải chunk cùng lúc', () => {
  assert.equal(PROFILE_START_STAGGER_MS, 8_000)
})

test('mỗi profile dùng worker riêng và state không phát lại toàn bộ danh sách', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(directory, 'data'))
  const first = store.create({ name: 'acc-1', host: 'server.test' })
  const second = store.create({ name: 'acc-2', host: 'server.test' })
  const events = []
  const manager = new BotManager(store, directory, (type, payload) => events.push({ type, payload }), { WorkerClass: FakeWorker, startStaggerMs: 0 })

  await Promise.all([manager.start(first.id), manager.start(second.id)])
  assert.equal(manager.workers.size, 2)
  assert.equal(manager.list().every((entry) => entry.runtime.status === 'online'), true)
  assert.equal(events.filter((event) => event.type === 'profiles-changed').length, 0)
  assert.equal(events.filter((event) => event.type === 'bot-event' && event.payload.type === 'state').length, 4)
  manager.stopAll()
})

test('giới hạn cache console 100 dòng khi nhiều account gửi log', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-'))
  const store = new ProfileStore(path.join(directory, 'data'))
  const profile = store.create({ name: 'acc', host: 'server.test' })
  const manager = new BotManager(store, directory, () => {}, { WorkerClass: FakeWorker, startStaggerMs: 0 })
  const entries = Array.from({ length: 900 }, (_, index) => ({ time: index, level: 'info', message: `log-${index}` }))
  manager.appendLogs(profile.id, entries)
  assert.equal(manager.list()[0].runtime.logs.length, 100)
  assert.equal(manager.list()[0].runtime.logs[0].message, 'log-800')
  manager.stopAll()
  fs.rmSync(directory, { recursive: true, force: true })
})

test('bật Auto Sell hoặc AutoSellAxe sẽ tự tắt module còn lại', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-mode-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(directory, 'data'))
  const profile = store.create({ name: 'axe-mode', host: 'server.test' })
  const manager = new BotManager(store, directory, () => {}, { WorkerClass: FakeWorker, startStaggerMs: 0 })

  const axe = await manager.update(profile.id, { autoSellAxeEnabled: true })
  assert.equal(axe.autoSellAxeEnabled, true)
  assert.equal(axe.autoSellEnabled, false)

  const sell = await manager.update(profile.id, { autoSellEnabled: true })
  assert.equal(sell.autoSellEnabled, true)
  assert.equal(sell.autoSellAxeEnabled, false)
  manager.stopAll()
})

test('có thể tắt worker theo profile và chuyển lại worker khi đã Stop', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(directory, 'data'))
  const profile = store.create({ name: 'direct-acc', host: 'server.test', workerEnabled: false })
  const manager = new BotManager(store, directory, () => {}, { WorkerClass: FakeWorker, SessionClass: FakeSession, startStaggerMs: 0 })

  await manager.start(profile.id)
  assert.equal(manager.directSessions.size, 1)
  assert.equal(manager.workers.size, 0)
  assert.equal(manager.list()[0].runtime.executionMode, 'main')
  await assert.rejects(() => manager.update(profile.id, { workerEnabled: true }), /Stop profile/)

  await manager.stop(profile.id)
  await manager.update(profile.id, { workerEnabled: true })
  await manager.start(profile.id)
  assert.equal(manager.directSessions.size, 0)
  assert.equal(manager.workers.size, 1)
  assert.equal(manager.list()[0].runtime.executionMode, 'worker')
  manager.stopAll()
})

test('Stop giải phóng hoàn toàn worker của account', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(directory, 'data'))
  const profile = store.create({ name: 'release-worker', host: 'server.test' })
  const manager = new BotManager(store, directory, () => {}, { WorkerClass: FakeWorker, startStaggerMs: 0 })

  await manager.start(profile.id)
  assert.equal(manager.workers.size, 1)
  assert.equal(manager.workers.get(profile.id).worker.options.resourceLimits.maxOldGenerationSizeMb, 128)
  await manager.stop(profile.id)
  assert.equal(manager.workers.size, 0)
  assert.equal(manager.list()[0].runtime.status, 'offline')
  assert.equal(manager.desiredRunning.has(profile.id), false)
  manager.stopAll()
})

test('heartbeat cập nhật heap và worker treo chỉ phục hồi đúng account', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(directory, 'data'))
  const first = store.create({ name: 'health-1', host: 'server.test' })
  const second = store.create({ name: 'health-2', host: 'server.test' })
  const manager = new BotManager(store, directory, () => {}, {
    WorkerClass: FakeWorker,
    startStaggerMs: 0,
    heartbeatTimeoutMs: 10,
    workerStaleCheckLimit: 1
  })
  await Promise.all([manager.start(first.id), manager.start(second.id)])

  const firstRecord = manager.workers.get(first.id)
  const secondRecord = manager.workers.get(second.id)
  manager.handleWorkerMessage(first.id, firstRecord, {
    type: 'heartbeat',
    at: Date.now(),
    health: { heapUsed: 12_345_678, heapTotal: 20_000_000 }
  })
  assert.equal(manager.runtimes.get(first.id).workerHealth.heapUsed, 12_345_678)

  const restarted = []
  manager.restartStalledWorker = async (id) => { restarted.push(id) }
  firstRecord.lastHeartbeatAt = Date.now()
  secondRecord.lastHeartbeatAt = 0
  manager.monitorWorkers()
  assert.deepEqual(restarted, [second.id])
  manager.stopAll()
})

test('năm account chạy worker độc lập; lỗi một account không đổi trạng thái bốn account còn lại', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(directory, 'data'))
  const profiles = Array.from({ length: 5 }, (_, index) => store.create({
    name: `load-${index + 1}`,
    host: 'server.test'
  }))
  const manager = new BotManager(store, directory, () => {}, { WorkerClass: FakeWorker, startStaggerMs: 0 })
  await Promise.all(profiles.map((profile) => manager.start(profile.id)))

  assert.equal(manager.workers.size, 5)
  assert.equal(manager.list().every((entry) => entry.runtime.status === 'online'), true)
  const failedProfile = profiles[2]
  manager.handleWorkerFailure(failedProfile.id, manager.workers.get(failedProfile.id), new Error('simulated stall'))
  const runtimes = new Map(manager.list().map((entry) => [entry.profile.id, entry.runtime]))
  assert.equal(runtimes.get(failedProfile.id).status, 'reconnecting')
  assert.equal(profiles.filter((profile) => profile.id !== failedProfile.id).every((profile) => runtimes.get(profile.id).status === 'online'), true)
  manager.stopAll()
})

test('treo nền bật chế độ tiết kiệm cho toàn bộ worker', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(directory, 'data'))
  const profiles = [1, 2].map((index) => store.create({ name: `headless-${index}`, host: 'server.test' }))
  const manager = new BotManager(store, directory, () => {}, { WorkerClass: FakeWorker, startStaggerMs: 0 })
  await Promise.all(profiles.map((profile) => manager.start(profile.id)))

  await manager.setResourceSavingMode(true)
  assert.equal(manager.resourceSavingMode, true)
  assert.equal([...manager.workers.values()].every((record) => record.worker.resourceSavingMode === true), true)
  await manager.setResourceSavingMode(false)
  assert.equal([...manager.workers.values()].every((record) => record.worker.resourceSavingMode === false), true)
  manager.stopAll()
})

test('thống kê nhiều account được gom thành một lần ghi profiles.json', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-manager-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(path.join(directory, 'data'))
  const first = store.create({ name: 'stats-1', host: 'server.test' })
  const second = store.create({ name: 'stats-2', host: 'server.test' })
  const writes = []
  const originalUpdateMany = store.updateMany.bind(store)
  store.updateMany = (entries) => {
    writes.push(entries)
    return originalUpdateMany(entries)
  }
  const manager = new BotManager(store, directory, () => {}, { WorkerClass: FakeWorker, startStaggerMs: 0 })

  manager.scheduleStatsPersist(first.id, { totalEarned: 10 })
  manager.scheduleStatsPersist(second.id, { totalEarned: 20 })
  manager.scheduleStatsPersist(first.id, { totalEarned: 30 })
  manager.flushPendingStats()

  assert.equal(writes.length, 1)
  assert.equal(writes[0].length, 2)
  assert.equal(store.get(first.id).lastStats.totalEarned, 30)
  manager.stopAll()
})
