const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { mergeProfile } = require('../src/core/ProfileStore')

test('worker profile khởi động độc lập và shutdown sạch khi chưa connect', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-worker-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const worker = new Worker(path.join(__dirname, '..', 'src', 'core', 'BotWorker.js'), {
    workerData: {
      profile: mergeProfile({ name: 'worker-test', host: 'server.test' }),
      authRoot: path.join(directory, 'auth'),
      logDirectory: path.join(directory, 'logs')
    }
  })
  t.after(() => worker.terminate())

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('worker ready timeout')), 3000)
    let ready = false
    let heartbeat = false
    worker.on('message', (message) => {
      if (message.type === 'ready') {
        assert.equal(message.runtime.status, 'offline')
        ready = true
      }
      if (message.type === 'heartbeat') {
        assert.ok(message.at > 0)
        assert.ok(message.health.heapUsed > 0)
        heartbeat = true
      }
      if (ready && heartbeat) {
        clearTimeout(timeout)
        resolve()
      }
    })
    worker.once('error', reject)
  })

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('worker shutdown timeout')), 3000)
    worker.on('message', (message) => {
      if (message.type !== 'response' || message.requestId !== 'shutdown-1') return
      clearTimeout(timeout)
      assert.equal(message.result.runtime.status, 'offline')
      resolve()
    })
    worker.postMessage({ type: 'command', action: 'shutdown', requestId: 'shutdown-1' })
  })
})

test('năm worker thật cùng khởi tạo heartbeat và shutdown độc lập', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-worker-load-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const workers = Array.from({ length: 5 }, (_, index) => new Worker(
    path.join(__dirname, '..', 'src', 'core', 'BotWorker.js'),
    {
      workerData: {
        profile: mergeProfile({ id: `worker-load-${index}`, name: `worker-load-${index}`, host: 'server.test' }),
        authRoot: path.join(directory, 'auth'),
        logDirectory: path.join(directory, 'logs')
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 }
    }
  ))
  t.after(() => Promise.all(workers.map((worker) => worker.terminate().catch(() => {}))))

  const health = await Promise.all(workers.map((worker, index) => new Promise((resolve, reject) => {
    const state = { ready: false, heartbeat: null }
    const timeout = setTimeout(() => reject(new Error(`worker ${index} load timeout`)), 5000)
    worker.on('message', (message) => {
      if (message.type === 'ready') state.ready = true
      if (message.type === 'heartbeat') state.heartbeat = message.health
      if (!state.ready || !state.heartbeat) return
      clearTimeout(timeout)
      resolve(state.heartbeat)
    })
    worker.once('error', reject)
  })))
  assert.equal(health.length, 5)
  assert.equal(health.every((entry) => entry.heapUsed > 0 && entry.heapTotal >= entry.heapUsed), true)

  await Promise.all(workers.map((worker, index) => new Promise((resolve, reject) => {
    const requestId = `load-shutdown-${index}`
    const timeout = setTimeout(() => reject(new Error(`worker ${index} shutdown timeout`)), 5000)
    worker.on('message', (message) => {
      if (message.type !== 'response' || message.requestId !== requestId) return
      clearTimeout(timeout)
      resolve()
    })
    worker.postMessage({ type: 'command', action: 'shutdown', requestId })
  })))
})
