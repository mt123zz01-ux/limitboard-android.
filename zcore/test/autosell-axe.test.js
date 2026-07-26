const test = require('node:test')
const assert = require('node:assert/strict')
const {
  AutoSellAxeController,
  LEFT_CLICK_INTERVAL_MS,
  LOOK_UP_CHECK_INTERVAL_MS,
  LOOK_UP_PITCH_RADIANS,
  normalizeAxeSettings,
  isLookingStraightUp
} = require('../src/core/AutoSellAxeController')

function fakeBot() {
  const calls = { swings: 0, looks: 0 }
  const bot = {
    currentWindow: { id: 7, slots: Array(90).fill(null) },
    entity: { yaw: 0.5, pitch: 0 },
    zcoreSwingLeft: () => {
      calls.swings += 1
      return true
    },
    zcoreIsLookingStraightUp: () => Math.abs(bot.entity.pitch + 90) <= 1,
    zcoreLookStraightUp: () => {
      calls.looks += 1
      bot.entity.pitch = -90
      return true
    }
  }
  return { bot, calls }
}

test('AutoSellAxe dùng nhịp chuột trái nhẹ và kiểm tra góc nhìn mỗi 5 phút', () => {
  assert.equal(LEFT_CLICK_INTERVAL_MS, 100)
  assert.equal(LOOK_UP_CHECK_INTERVAL_MS, 300_000)
  assert.equal(LOOK_UP_PITCH_RADIANS, -Math.PI / 2)
})

test('giữ chuột trái vẫn chạy khi GUI đang mở', () => {
  const { bot, calls } = fakeBot()
  const controller = new AutoSellAxeController(bot, () => {}, { autoSellAxeEnabled: true })
  controller.running = true

  assert.equal(controller.swing(), true)
  assert.equal(calls.swings, 1)
  assert.equal(controller.snapshot().leftClickHeld, true)
})

test('bật module gửi chuột trái ngay và tắt sẽ giải phóng toàn bộ timer', () => {
  const { bot, calls } = fakeBot()
  const controller = new AutoSellAxeController(bot, () => {}, { autoSellAxeEnabled: true })

  controller.start()
  assert.equal(calls.swings, 1)
  assert.ok(controller.swingTimer)
  assert.ok(controller.lookTimer)
  controller.stop()
  assert.equal(controller.swingTimer, null)
  assert.equal(controller.lookTimer, null)
  assert.equal(controller.running, false)
})

test('sau reconnect controller mới tự giữ chuột trái lại theo setting profile', () => {
  const first = fakeBot()
  const firstController = new AutoSellAxeController(first.bot, () => {}, { autoSellAxeEnabled: true })
  firstController.start()
  firstController.stop()

  const reconnected = fakeBot()
  const nextController = new AutoSellAxeController(reconnected.bot, () => {}, { autoSellAxeEnabled: true })
  nextController.start()
  assert.equal(reconnected.calls.swings, 1)
  assert.equal(nextController.running, true)
  nextController.stop()
})

test('chỉ chỉnh nhìn lên trời khi đang lệch và công tắc cho phép', async () => {
  const { bot, calls } = fakeBot()
  const controller = new AutoSellAxeController(bot, () => {}, {
    autoSellAxeEnabled: true,
    autoSellAxeLookUpEnabled: true
  })
  controller.running = true

  assert.equal(await controller.checkLook(), true)
  assert.equal(calls.looks, 1)
  assert.equal(await controller.checkLook(), false)
  assert.equal(calls.looks, 1)

  controller.setSettings({ autoSellAxeEnabled: true, autoSellAxeLookUpEnabled: false })
  bot.entity.pitch = 0
  assert.equal(await controller.checkLook(), false)
  assert.equal(calls.looks, 1)
  controller.stop()
})

test('Mineflayer dùng góc radian để nhận biết đang nhìn thẳng lên trời', () => {
  assert.equal(isLookingStraightUp({ entity: { pitch: -Math.PI / 2 } }), true)
  assert.equal(isLookingStraightUp({ entity: { pitch: 0 } }), false)
  assert.deepEqual(normalizeAxeSettings({}), { enabled: false, lookUpEnabled: true })
})
