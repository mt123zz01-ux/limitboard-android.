const { parentPort, workerData } = require('node:worker_threads')
const { BotSession } = require('./BotSession')
const { FileLogger } = require('./FileLogger')

if (!parentPort) throw new Error('BotWorker chỉ được chạy trong worker thread')

const WORKER_HEARTBEAT_INTERVAL_MS = 10_000
const HEADLESS_HEARTBEAT_INTERVAL_MS = 15_000
const WORKER_STATE_HEARTBEAT_MS = 30_000
const STATE_DEBOUNCE_MS = 200
const fileLogger = new FileLogger(workerData.logDirectory)
let stateTimer = null
let latestState = null
let lastStateSignature = null
let lastStateSentAt = 0
let logTimer = null
let pendingLogs = []
let shuttingDown = false
let heartbeatTimer = null

function post(message) {
  if (!shuttingDown || message.type === 'response') parentPort.postMessage(message)
}

function flushState() {
  stateTimer = null
  if (!latestState) return
  const snapshot = latestState
  latestState = null
  lastStateSignature = stateSignature(snapshot)
  lastStateSentAt = Date.now()
  post({ type: 'event', eventType: 'state', payload: snapshot })
}

function stateSignature(snapshot) {
  return [
    snapshot?.status,
    snapshot?.username,
    snapshot?.autoSellState,
    snapshot?.autoSellPaused,
    snapshot?.autoSellAxe?.running,
    snapshot?.autoSellAxe?.leftClickHeld,
    snapshot?.autoSellAxe?.lookUpEnabled,
    snapshot?.autoSellAxe?.lastLookCorrectionAt,
    snapshot?.autoHome?.running,
    snapshot?.autoHome?.homeNumber,
    snapshot?.autoHome?.delayMinutes,
    snapshot?.autoHome?.nextSendAt,
    snapshot?.autoHome?.lastSentAt,
    snapshot?.autoHome?.waitingForSafeWindow,
    snapshot?.blockedByProtection,
    snapshot?.lastError,
    snapshot?.network?.failedAttempts,
    snapshot?.stats?.totalEarned,
    snapshot?.stats?.totalSalesCount,
    snapshot?.balance?.amount,
    snapshot?.balance?.source,
    snapshot?.balance?.requestPending,
    snapshot?.balance?.requestTimedOut,
    snapshot?.balance?.lastResponseAt,
    snapshot?.balance?.lastRequestError
  ].map((value) => value == null ? '' : String(value)).join('\u0000')
}

function queueState(snapshot) {
  latestState = snapshot
  const now = Date.now()
  const changed = stateSignature(snapshot) !== lastStateSignature
  if (!changed && now - lastStateSentAt < WORKER_STATE_HEARTBEAT_MS) return
  if (stateTimer) return
  stateTimer = setTimeout(flushState, STATE_DEBOUNCE_MS)
  stateTimer.unref?.()
}

function flushLogs() {
  logTimer = null
  if (!pendingLogs.length) return
  const entries = pendingLogs
  pendingLogs = []
  post({ type: 'event', eventType: 'log-batch', payload: entries })
}

function queueLog(entry) {
  pendingLogs.push(entry)
  if (pendingLogs.length >= 50) return flushLogs()
  if (logTimer) return
  logTimer = setTimeout(flushLogs, 250)
  logTimer.unref?.()
}

function sendHeartbeat() {
  const memory = process.memoryUsage()
  post({
    type: 'heartbeat',
    at: Date.now(),
    health: {
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external
    }
  })
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  const interval = session.resourceSavingMode ? HEADLESS_HEARTBEAT_INTERVAL_MS : WORKER_HEARTBEAT_INTERVAL_MS
  heartbeatTimer = setInterval(sendHeartbeat, interval)
  heartbeatTimer.unref?.()
}

const session = new BotSession(
  workerData.profile,
  workerData.authRoot,
  (type, payload) => {
    if (type === 'state') queueState(payload)
    else if (type === 'log') queueLog(payload)
    else post({ type: 'event', eventType: type, payload })
  },
  (stats) => post({ type: 'persist-stats', stats }),
  fileLogger,
  { retainLogs: false }
)
session.resourceSavingMode = workerData.headlessMode === true

function reply(requestId, result = null, error = null) {
  if (!requestId) return
  post({
    type: 'response',
    requestId,
    result,
    error: error ? { message: error.message || String(error), stack: error.stack || '' } : null
  })
}

async function runCommand(message) {
  const { action, requestId, payload } = message
  try {
    if (action === 'start') session.start()
    else if (action === 'stop') session.stop()
    else if (action === 'reset-stats') session.resetStats()
    else if (action === 'send-chat') session.sendChat(payload?.text)
    else if (action === 'apply-profile') session.applyProfile(payload?.profile)
    else if (action === 'set-resource-saving') {
      session.setResourceSavingMode(payload?.enabled)
      startHeartbeat()
    }
    else if (action === 'shutdown') {
      if (session.status !== 'offline') session.stop()
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = null
      flushState()
      flushLogs()
      await fileLogger.flush()
      reply(requestId, { runtime: session.snapshot(false) })
      shuttingDown = true
      parentPort.close()
      return
    } else throw new Error(`Lệnh worker không hợp lệ: ${action}`)

    flushState()
    reply(requestId, { runtime: session.snapshot(false) })
  } catch (error) {
    reply(requestId, null, error)
  }
}

parentPort.on('message', (message) => {
  if (message?.type === 'command') runCommand(message)
})

post({ type: 'ready', runtime: session.snapshot(false) })
sendHeartbeat()
startHeartbeat()

module.exports = {
  WORKER_HEARTBEAT_INTERVAL_MS,
  HEADLESS_HEARTBEAT_INTERVAL_MS,
  WORKER_STATE_HEARTBEAT_MS,
  STATE_DEBOUNCE_MS
}
