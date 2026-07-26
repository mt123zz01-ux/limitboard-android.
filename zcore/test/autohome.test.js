const test = require('node:test')
const assert = require('node:assert/strict')
const {
  AutoHomeController,
  SAFE_WINDOW_RETRY_MS,
  normalizeHomeSettings
} = require('../src/core/AutoHomeController')
const {
  BotSession,
  AUTO_HOME_PAUSE_REASON
} = require('../src/core/BotSession')
const { STATES } = require('../src/core/AutoSellController')

function fakeBot() {
  const commands = []
  return {
    commands,
    bot: {
      chat(command) {
        commands.push(command)
      }
    }
  }
}

test('Auto Home chuẩn hóa bật/tắt, số Home 1–4 và delay theo phút', () => {
  assert.deepEqual(normalizeHomeSettings({
    autoHomeEnabled: true,
    autoHomeNumber: 9,
    autoHomeDelayMinutes: 0
  }), {
    enabled: true,
    homeNumber: 4,
    delayMinutes: 1,
    delayMs: 60_000
  })

  assert.deepEqual(normalizeHomeSettings({}), {
    enabled: false,
    homeNumber: 1,
    delayMinutes: 5,
    delayMs: 300_000
  })
})

test('bật Auto Home sẽ chờ đủ delay, không gửi ngay khi ONLINE', () => {
  const { bot, commands } = fakeBot()
  const controller = new AutoHomeController(bot, () => {}, {
    autoHomeEnabled: true,
    autoHomeNumber: 2,
    autoHomeDelayMinutes: 3
  })
  const before = Date.now()

  assert.equal(controller.start(), true)
  assert.deepEqual(commands, [])
  assert.ok(controller.nextSendAt - before >= 179_900)
  assert.ok(controller.nextSendAt - before <= 180_100)
  controller.stop()
})

test('đến giờ nhưng GUI chưa an toàn thì chờ 1 giây và chưa gửi lệnh', async () => {
  const { bot, commands } = fakeBot()
  const controller = new AutoHomeController(bot, () => {}, {
    autoHomeEnabled: true,
    autoHomeNumber: 3,
    autoHomeDelayMinutes: 5
  }, {
    canSend: () => false
  })
  controller.running = true
  const before = Date.now()

  assert.equal(await controller.trySend(), false)
  assert.deepEqual(commands, [])
  assert.equal(controller.waitingForSafeWindow, true)
  assert.ok(controller.nextSendAt - before >= SAFE_WINDOW_RETRY_MS - 100)
  assert.ok(controller.nextSendAt - before <= SAFE_WINDOW_RETRY_MS + 100)
  controller.stop()
})

test('khi an toàn sẽ gửi đúng /home N, chạy hook và lên lịch vòng kế tiếp', async () => {
  const { bot, commands } = fakeBot()
  const events = []
  const after = []
  const context = { shouldResume: true }
  const controller = new AutoHomeController(bot, (type, payload) => events.push({ type, payload }), {
    autoHomeEnabled: true,
    autoHomeNumber: 4,
    autoHomeDelayMinutes: 2
  }, {
    canSend: () => true,
    beforeSend: () => context,
    afterSend: (result) => after.push(result)
  })
  controller.running = true
  const before = Date.now()

  assert.equal(await controller.trySend(), true)
  assert.deepEqual(commands, ['/home 4'])
  assert.equal(after.length, 1)
  assert.equal(after[0].sent, true)
  assert.equal(after[0].context, context)
  assert.equal(events.some(({ type, payload }) => type === 'autohome' && payload.command === '/home 4'), true)
  assert.ok(controller.nextSendAt - before >= 119_900)
  controller.stop()
})

test('tắt Auto Home sẽ hủy lịch gửi đang chờ', () => {
  const { bot } = fakeBot()
  const controller = new AutoHomeController(bot, () => {}, {
    autoHomeEnabled: true,
    autoHomeDelayMinutes: 10
  })
  controller.start()

  controller.setSettings({ autoHomeEnabled: false })

  assert.equal(controller.running, false)
  assert.equal(controller.timer, null)
  assert.equal(controller.nextSendAt, 0)
})

test('BotSession chỉ gửi Home ngoài GUI Sell và chỉ resume đúng pause của Auto Home', async () => {
  const session = new BotSession({
    id: 'home-session',
    autoHomeEnabled: true,
    autoSellEnabled: true,
    balanceTrackingEnabled: false,
    whitelistedPlayers: []
  }, '')
  const bot = { currentWindow: null }
  const resumeReasons = []
  session.bot = bot
  session.status = 'online'
  session.generation = 4
  session.controller = {
    running: true,
    paused: false,
    busy: false,
    state: STATES.WAITING_AFTER_SELL,
    pause(reason) {
      this.paused = true
      this.pauseReason = reason
    },
    resume(reason) {
      if (reason !== this.pauseReason) return false
      resumeReasons.push(reason)
      this.paused = false
      return true
    }
  }

  assert.equal(session.canSendAutoHome(bot, 4), true)
  bot.currentWindow = { id: 7 }
  assert.equal(session.canSendAutoHome(bot, 4), false)
  bot.currentWindow = null
  session.controller.state = STATES.MOVING_ITEMS
  assert.equal(session.canSendAutoHome(bot, 4), false)
  session.controller.state = STATES.WAITING_AFTER_SELL

  const context = session.pauseAutoSellForHome()
  assert.equal(context.shouldResume, true)
  assert.equal(session.controller.pauseReason, AUTO_HOME_PAUSE_REASON)
  session.resumeAutoSellAfterHome({ sent: false, context })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(resumeReasons, [AUTO_HOME_PAUSE_REASON])
  session.stopRuntimeTimers(false)
})
