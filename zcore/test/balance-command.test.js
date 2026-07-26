const test = require('node:test')
const assert = require('node:assert/strict')
const {
  BotSession,
  afkRuntimeOptions,
  isBalanceCommand,
  profileStaggerOffset,
  RUNTIME_STATE_INTERVAL_MS,
  BALANCE_COMMAND_INTERVAL_MS,
  BALANCE_COMMAND_INITIAL_DELAY_MS,
  BALANCE_COMMAND_STAGGER_WINDOW_MS,
  BALANCE_COMMAND_RESPONSE_TIMEOUT_MS
} = require('../src/core/BotSession')

function makeSession(balanceCommandEnabled) {
  return new BotSession({
    id: 'balance-test',
    balanceTrackingEnabled: true,
    balanceCommandEnabled,
    discordWebhookIntervalMinutes: 60
  }, '/tmp')
}

test('/balance chạy mỗi 30 giây và được giãn thời điểm giữa các profile', () => {
  assert.equal(BALANCE_COMMAND_INTERVAL_MS, 30_000)
  assert.equal(BALANCE_COMMAND_INITIAL_DELAY_MS, 2_000)
  assert.equal(BALANCE_COMMAND_STAGGER_WINDOW_MS, 8_000)
  const firstDelay = BALANCE_COMMAND_INITIAL_DELAY_MS + profileStaggerOffset('account-1', BALANCE_COMMAND_STAGGER_WINDOW_MS)
  const secondDelay = BALANCE_COMMAND_INITIAL_DELAY_MS + profileStaggerOffset('account-2', BALANCE_COMMAND_STAGGER_WINDOW_MS)
  assert.ok(firstDelay >= 2_000 && firstDelay < 10_000)
  assert.ok(secondDelay >= 2_000 && secondDelay < 10_000)
  assert.notEqual(firstDelay, secondDelay)
  assert.equal(RUNTIME_STATE_INTERVAL_MS, 5_000)
})

test('AFK Max tắt physics, giảm view distance và chat pattern nhưng vẫn có thể tắt setting', () => {
  assert.deepEqual(afkRuntimeOptions({ afkLiteEnabled: true }), {
    physicsEnabled: false,
    viewDistance: 2,
    maxCatchupTicks: 1,
    defaultChatPatterns: false,
    colorsEnabled: false
  })
  assert.deepEqual(afkRuntimeOptions({ afkLiteEnabled: false }), {
    physicsEnabled: true,
    viewDistance: 'far',
    maxCatchupTicks: 4,
    defaultChatPatterns: true,
    colorsEnabled: true
  })
})

test('chỉ gửi /balance khi setting bật và bot đang online', () => {
  const sent = []
  const enabled = makeSession(true)
  enabled.bot = { chat: (message) => sent.push(message) }
  enabled.status = 'online'
  assert.equal(enabled.requestBalance(), true)
  assert.deepEqual(sent, ['/balance'])
  assert.ok(enabled.lastBalanceCommandAt > 0)

  const disabled = makeSession(false)
  disabled.bot = { chat: (message) => sent.push(message) }
  disabled.status = 'online'
  assert.equal(disabled.requestBalance(), false)
  assert.deepEqual(sent, ['/balance'])

  enabled.status = 'offline'
  assert.equal(enabled.requestBalance(), false)
})

test('/balance chỉ nhận phản hồi nghiêm ngặt của yêu cầu đang chờ', () => {
  const session = makeSession(true)
  session.bot = { chat: () => {} }
  session.status = 'online'

  assert.equal(session.requestBalance(), true)
  assert.equal(session.balanceSnapshot().requestPending, true)
  assert.equal(session.acceptBalanceResponse('You have paid Player $2M'), null)
  assert.equal(session.balanceSnapshot().requestPending, true)
  assert.equal(session.balanceTracker.snapshot().amount, null)

  assert.equal(session.acceptBalanceResponse('You have $ 80,055,020'), 80_055_020)
  assert.equal(session.balanceSnapshot().requestPending, false)
  assert.equal(session.balanceSnapshot().requestTimedOut, false)
  assert.equal(session.balanceTracker.snapshot().amount, 80_055_020)
  assert.equal(session.balanceTracker.snapshot().source, 'balance-command')

  assert.equal(session.acceptBalanceResponse('You have $999M'), null)
  assert.equal(session.balanceTracker.snapshot().amount, 80_055_020)
})

test('lệnh /balance nhập thủ công cũng mở trạng thái chờ phản hồi', () => {
  const sent = []
  const session = makeSession(false)
  session.bot = { chat: (message) => sent.push(message) }
  session.status = 'online'

  session.sendChat('/balance')
  assert.deepEqual(sent, ['/balance'])
  assert.equal(session.balanceSnapshot().requestPending, true)
  assert.equal(session.acceptBalanceResponse('Balance: $12.5M'), 12_500_000)

  const previousRequest = session.lastBalanceCommandAt
  session.sendChat('/pay Player 1000')
  assert.equal(session.lastBalanceCommandAt, previousRequest)
  assert.equal(isBalanceCommand('/balance'), true)
  assert.equal(isBalanceCommand(' /BALANCE '), true)
  assert.equal(isBalanceCommand('/balance Player'), false)
})

test('yêu cầu số dư hết hạn được báo timeout nhưng giữ số dư cũ', () => {
  const session = makeSession(true)
  session.balanceTracker.update(25_000, 'balance-command')
  session.markBalanceRequest(1_000)

  const pending = session.balanceSnapshot(1_000 + BALANCE_COMMAND_RESPONSE_TIMEOUT_MS - 1)
  const timedOut = session.balanceSnapshot(1_000 + BALANCE_COMMAND_RESPONSE_TIMEOUT_MS + 1)
  assert.equal(pending.requestPending, true)
  assert.equal(timedOut.requestPending, false)
  assert.equal(timedOut.requestTimedOut, true)
  assert.equal(timedOut.amount, 25_000)
})

test('không chạy timer bảo vệ khi cả hai chức năng bảo vệ đều tắt', () => {
  const session = makeSession(true)
  session.status = 'online'
  session.profile.coordinateProtectionEnabled = false
  session.profile.whitelistGuardEnabled = false
  session.startProtectionTimer()
  assert.equal(session.protectionTimer, null)

  session.profile.coordinateProtectionEnabled = true
  session.startProtectionTimer()
  assert.ok(session.protectionTimer)
  session.stopRuntimeTimers(false)
})

test('tắt theo dõi số dư là tắt thật: không gửi lệnh, không đọc chat và không poll scoreboard', () => {
  const sent = []
  const session = makeSession(true)
  session.profile.balanceTrackingEnabled = false
  session.bot = { chat: (message) => sent.push(message) }
  session.status = 'online'

  assert.equal(session.requestBalance(), false)
  assert.deepEqual(sent, [])
  assert.equal(session.balanceSnapshot().trackingEnabled, false)
  assert.equal(session.shouldProcessIncomingMessage(), false)

  session.profile.consoleEnabled = true
  session.resourceSavingMode = false
  assert.equal(session.shouldProcessIncomingMessage(), true)
})

test('worker có thể bỏ bản sao cache log nhưng vẫn phát log ra main process', () => {
  const emitted = []
  const session = new BotSession({
    id: 'lean-logs',
    balanceTrackingEnabled: false,
    discordWebhookIntervalMinutes: 60
  }, '/tmp', (type, payload) => emitted.push({ type, payload }), () => {}, null, {
    retainLogs: false
  })
  session.log('dòng kiểm thử')
  assert.equal(session.logs.length, 0)
  assert.equal(emitted.at(-1).type, 'log')
  assert.equal(emitted.at(-1).payload.message, 'dòng kiểm thử')
})
