const test = require('node:test')
const assert = require('node:assert/strict')
const {
  BotSession,
  reconnectDelay,
  authReconnectDelay,
  connectionFailureInfo,
  webhookIntervalMs,
  NETWORK_WATCHDOG_INTERVAL_MS,
  RECONNECT_STAGGER_WINDOW_MS,
  AUTH_RECONNECT_BASE_SECONDS,
  AUTH_RECONNECT_MAX_SECONDS
} = require('../src/core/BotSession')
const {
  PROFILE_NOT_FOUND,
  AUTH_UNAVAILABLE
} = require('../src/core/MicrosoftAuthenticator')

test('reconnect tăng dần khi lỗi liên tiếp và không vượt giới hạn', () => {
  const profile = { reconnectDelaySeconds: 10, reconnectMaxDelaySeconds: 60 }
  assert.equal(reconnectDelay(profile, 0), 10)
  assert.equal(reconnectDelay(profile, 1), 20)
  assert.equal(reconnectDelay(profile, 2), 40)
  assert.equal(reconnectDelay(profile, 3), 60)
  assert.equal(reconnectDelay(profile, 10), 60)
  assert.equal(RECONNECT_STAGGER_WINDOW_MS, 8_000)
})

test('lỗi auth dùng backoff riêng 30 giây đến tối đa 5 phút', () => {
  assert.equal(AUTH_RECONNECT_BASE_SECONDS, 30)
  assert.equal(AUTH_RECONNECT_MAX_SECONDS, 300)
  assert.equal(authReconnectDelay(0), 30)
  assert.equal(authReconnectDelay(1), 60)
  assert.equal(authReconnectDelay(2), 120)
  assert.equal(authReconnectDelay(3), 240)
  assert.equal(authReconnectDelay(4), 300)
  assert.equal(authReconnectDelay(20), 300)
})

test('không còn kết luận nhầm tài khoản chưa mua game khi auth server mất kết nối', () => {
  const transient = new Error('Failed to obtain profile data for acc@example.com, does the account own minecraft?')
  const info = connectionFailureInfo(transient, {
    phase: 'reconnecting',
    hasAuthenticatedBefore: true
  })
  assert.equal(info.kind, 'auth-service')
  assert.equal(info.retryable, true)
  assert.match(info.message, /đã từng vào server/)

  const missing = new Error('Tài khoản không có Minecraft Java')
  missing.code = PROFILE_NOT_FOUND
  missing.retryable = false
  const missingInfo = connectionFailureInfo(missing)
  assert.equal(missingInfo.kind, 'account')
  assert.equal(missingInfo.retryable, false)
})

test('lỗi xác thực trước TCP được giải phóng và đưa thẳng vào lịch reconnect', () => {
  const profile = {
    id: 'auth-retry',
    autoReconnectEnabled: true,
    whitelistedPlayers: []
  }
  const session = new BotSession(profile, '/tmp')
  const ended = []
  const bot = {
    _client: {
      end: (reason) => ended.push(reason),
      socket: { destroy: () => ended.push('destroy') }
    }
  }
  const scheduled = []
  session.bot = bot
  session.generation = 4
  session.status = 'reconnecting'
  session.manualStop = false
  session.scheduleReconnect = (failure) => scheduled.push(failure)
  const error = new Error('Không thể lấy profile')
  error.code = AUTH_UNAVAILABLE
  error.retryable = true

  session.handleBotError(bot, 4, error)

  assert.equal(session.bot, null)
  assert.equal(session.failedAttempts, 1)
  assert.equal(session.lastError, 'Chưa lấy được profile Minecraft; có thể dịch vụ xác thực hoặc mạng đang gián đoạn.')
  assert.deepEqual(ended, ['ZCore pre-connect failure', 'destroy'])
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].kind, 'auth-service')
})

test('đổi phút cấu hình Webhook thành mili giây an toàn', () => {
  assert.equal(webhookIntervalMs({ discordWebhookIntervalMinutes: 15 }), 900_000)
  assert.equal(webhookIntervalMs({ discordWebhookIntervalMinutes: 0 }), 60_000)
  assert.equal(webhookIntervalMs({}), 3_600_000)
})

test('watchdog chủ động reconnect khi socket im lặng thay vì để account đứng yên', () => {
  const ended = []
  const session = new BotSession({
    id: 'watchdog',
    networkStallTimeoutSeconds: 75,
    whitelistedPlayers: []
  }, '/tmp')
  session.status = 'online'
  session.lastPacketAt = 1_000
  session.bot = { _client: { end: (reason) => ended.push(reason), socket: null } }

  assert.equal(NETWORK_WATCHDOG_INTERVAL_MS, 15_000)
  assert.equal(session.checkNetworkHealth(75_999), false)
  assert.equal(session.checkNetworkHealth(76_001), true)
  assert.deepEqual(ended, ['ZCore network watchdog'])
  assert.equal(session.checkNetworkHealth(200_000), false)
  session.status = 'offline'
})
