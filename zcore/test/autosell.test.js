const test = require('node:test')
const assert = require('node:assert/strict')
const {
  AutoSellController,
  STATES,
  CHECK_INTERVAL_MS,
  OPEN_TIMEOUT_MS,
  INVENTORY_CHECK_DELAY_MIN_MS,
  INVENTORY_CHECK_DELAY_MAX_MS,
  QUICK_ALL_DELAY_MIN_MS,
  QUICK_ALL_DELAY_MAX_MS,
  MOVE_DELAY_MIN_MS,
  MOVE_DELAY_MAX_MS,
  CLOSE_DELAY_MS,
  CYCLE_DELAY_MIN_MS,
  CYCLE_DELAY_MAX_MS,
  TOTAL_SELL_SLOTS,
  PLAYER_SLOT_COUNT,
  SELL_COMMAND,
  isSameQuickMoveItem,
  normalizeDelaySettings
} = require('../src/core/AutoSellController')

function item(type, count = 1, components = []) {
  return {
    type,
    name: `item-${type}`,
    count,
    metadata: 0,
    nbt: null,
    components,
    removedComponents: []
  }
}

function inventory(entries = {}) {
  const slots = Array(46).fill(null)
  for (const [slot, value] of Object.entries(entries)) slots[Number(slot)] = value
  return { id: 0, type: 'minecraft:inventory', slots, inventoryStart: 9, inventoryEnd: 45 }
}

function sellWindow(id = 7, entries = {}) {
  const slots = Array(TOTAL_SELL_SLOTS).fill(null)
  for (const [slot, value] of Object.entries(entries)) slots[Number(slot)] = value
  return {
    id,
    title: 'Sell',
    type: 'minecraft:generic_9x6',
    slots,
    inventoryStart: 54,
    inventoryEnd: 90
  }
}

function fakeBot(window = null, playerInventory = inventory()) {
  const commands = []
  const clicks = []
  const closed = []
  const bot = {
    inventory: playerInventory,
    currentWindow: window,
    chat: (text) => commands.push(text),
    clickWindow: async (slot, mouseButton, mode) => {
      clicks.push([slot, mouseButton, mode])
      if (bot.currentWindow?.slots[slot]) bot.currentWindow.slots[slot] = null
    },
    closeWindow: (target) => {
      closed.push(target.id)
      if (bot.currentWindow === target) bot.currentWindow = null
    }
  }
  return { bot, commands, clicks, closed }
}

function arm(controller, state) {
  controller.running = true
  controller.state = state
  controller.delayUntil = 0
}

test('hằng số Auto Sell Repair 20 dùng cấu hình nhanh khuyên dùng', () => {
  assert.equal(CHECK_INTERVAL_MS, 1_000)
  assert.equal(OPEN_TIMEOUT_MS, 3_000)
  assert.equal(INVENTORY_CHECK_DELAY_MIN_MS, 100)
  assert.equal(INVENTORY_CHECK_DELAY_MAX_MS, 200)
  assert.equal(QUICK_ALL_DELAY_MIN_MS, 50)
  assert.equal(QUICK_ALL_DELAY_MAX_MS, 100)
  assert.equal(MOVE_DELAY_MIN_MS, 250)
  assert.equal(MOVE_DELAY_MAX_MS, 400)
  assert.equal(CLOSE_DELAY_MS, 200)
  assert.equal(CYCLE_DELAY_MIN_MS, 150)
  assert.equal(CYCLE_DELAY_MAX_MS, 300)
  assert.equal(TOTAL_SELL_SLOTS, 90)
  assert.equal(PLAYER_SLOT_COUNT, 36)
  assert.equal(SELL_COMMAND, '/sell')
})

test('bật module bắt đầu ở bước kiểm tra inventory và không có initial delay', () => {
  const { bot } = fakeBot()
  const controller = new AutoSellController(bot)
  controller.start()

  assert.equal(controller.state, STATES.CHECKING_INVENTORY)
  assert.equal(controller.delayUntil, 0)
  controller.stop()
})

test('inventory trống chờ random mặc định 0,1–0,2 giây rồi kiểm tra lại', async () => {
  const { bot, commands } = fakeBot()
  const controller = new AutoSellController(bot, () => {}, {}, () => 0.5)
  arm(controller, STATES.CHECKING_INVENTORY)
  const before = Date.now()

  await controller.tick()

  assert.deepEqual(commands, [])
  assert.equal(controller.state, STATES.CHECKING_INVENTORY)
  assert.ok(controller.delayUntil - before >= 140)
  assert.ok(controller.delayUntil - before <= 210)
})

test('chỉ cần có item trong 36 slot cuối là gửi /sell ngay', async () => {
  const playerInventory = inventory({ 45: item(1) })
  const { bot, commands } = fakeBot(null, playerInventory)
  const controller = new AutoSellController(bot)
  arm(controller, STATES.CHECKING_INVENTORY)

  await controller.tick()

  assert.deepEqual(commands, ['/sell'])
  assert.equal(controller.state, STATES.WAITING_GUI)
  assert.ok(controller.guiWaitDeadline - Date.now() > 2_900)
})

test('giống source gốc: chỉ kiểm tra 36 slot cuối, không tự sửa phạm vi', async () => {
  const playerInventory = inventory({ 9: item(1) })
  const { bot, commands } = fakeBot(null, playerInventory)
  const controller = new AutoSellController(bot)
  arm(controller, STATES.CHECKING_INVENTORY)

  await controller.tick()

  assert.deepEqual(commands, [])
  assert.equal(controller.state, STATES.CHECKING_INVENTORY)
})

test('chỉ nhận GUI đúng 90 slot; timeout 3 giây không tự đóng GUI khác', async () => {
  const wrongWindow = { id: 3, slots: Array(89).fill(null) }
  const { bot, closed } = fakeBot(wrongWindow)
  const controller = new AutoSellController(bot)
  arm(controller, STATES.WAITING_GUI)
  controller.guiWaitDeadline = Date.now() - 1

  await controller.tick()

  assert.equal(controller.state, STATES.CHECKING_INVENTORY)
  assert.deepEqual(closed, [])
  assert.equal(bot.currentWindow, wrongWindow)
  assert.ok(controller.delayUntil > Date.now())
})

test('quickAll chuyển mọi stack giống hệt, mỗi item ID một lần và nghỉ random giữa nhóm', async () => {
  const componentA = [{ type: 'custom_name', data: 'A' }]
  const componentB = [{ type: 'custom_name', data: 'B' }]
  const window = sellWindow(9, {
    54: item(1, 10, componentA),
    55: item(1, 20, componentA),
    56: item(2, 5),
    57: item(1, 1, componentB),
    58: item(2, 4)
  })
  const { bot, clicks } = fakeBot(window)
  const sleeps = []
  const controller = new AutoSellController(
    bot,
    () => {},
    {},
    () => 0.5,
    async (milliseconds) => sleeps.push(milliseconds)
  )
  arm(controller, STATES.WAITING_GUI)
  controller.guiWaitDeadline = Date.now() + OPEN_TIMEOUT_MS
  const before = Date.now()

  await controller.tick()

  assert.deepEqual(clicks, [
    [54, 0, 1],
    [55, 0, 1],
    [56, 0, 1],
    [58, 0, 1]
  ])
  assert.equal(window.slots[57].components[0].data, 'B')
  assert.equal(controller.movedStacks, 4)
  assert.equal(controller.movedItems, 39)
  assert.equal(controller.state, STATES.WAITING_AFTER_MOVE)
  assert.deepEqual(sleeps, [75, 75])
  assert.ok(controller.delayUntil - before >= 300)
  assert.ok(controller.delayUntil - before <= 450)
})

test('quickAll so item theo type và components nhưng bỏ qua số lượng stack', () => {
  const first = item(1, 64, [{ type: 'damage', data: 2 }])
  const same = item(1, 1, [{ type: 'damage', data: 2 }])
  const different = item(1, 1, [{ type: 'damage', data: 3 }])

  assert.equal(isSameQuickMoveItem(first, same), true)
  assert.equal(isSameQuickMoveItem(first, different), false)
})

test('sau quickAll đóng đúng GUI, chờ delay vòng rồi lặp', async () => {
  const events = []
  const window = sellWindow(12)
  const playerInventory = inventory({ 45: item(3) })
  const { bot, commands, closed } = fakeBot(window, playerInventory)
  const controller = new AutoSellController(bot, (type, payload) => events.push({ type, payload }))
  arm(controller, STATES.WAITING_AFTER_MOVE)
  controller.activeSellWindow = window
  controller.movedItems = 64
  controller.movedStacks = 1
  const before = Date.now()

  await controller.tick()

  assert.deepEqual(closed, [12])
  assert.equal(controller.state, STATES.WAITING_AFTER_SELL)
  assert.ok(controller.delayUntil - before >= 140)
  assert.ok(controller.delayUntil - before <= 310)
  assert.equal(events.some(({ type, payload }) => (
    type === 'autosell' &&
    payload.state === STATES.WAITING_AFTER_SELL &&
    payload.completed === true
  )), true)

  controller.delayUntil = 0
  await controller.tick()
  assert.deepEqual(commands, ['/sell'])
  assert.equal(controller.state, STATES.WAITING_GUI)
})

test('lỗi click được ghi log và vòng Auto Sell tự tiếp tục sau 1 giây', async () => {
  const logs = []
  const window = sellWindow(15, { 54: item(1) })
  const { bot } = fakeBot(window)
  bot.clickWindow = async () => { throw new Error('server rejected click') }
  const controller = new AutoSellController(bot, (type, payload) => {
    if (type === 'log') logs.push(payload)
  })
  arm(controller, STATES.WAITING_GUI)
  controller.guiWaitDeadline = Date.now() + OPEN_TIMEOUT_MS
  const before = Date.now()

  await controller.tick()

  assert.equal(controller.state, STATES.ERROR_COOLDOWN)
  assert.match(logs.at(-1).message, /server rejected click/)
  assert.ok(controller.delayUntil - before >= 950)
  assert.ok(controller.delayUntil - before <= 1_100)
})

test('delay Auto Sell cố định chỉ thay thời gian nghỉ sau khi đóng GUI', () => {
  const { bot } = fakeBot()
  const controller = new AutoSellController(bot, () => {}, {
    autoSellDelaySeconds: 2.5,
    autoSellRandomDelayEnabled: false
  })

  assert.equal(controller.nextCycleDelayMs(), 2_500)
  assert.equal(controller.nextInventoryCheckDelayMs() >= 100, true)
  assert.equal(controller.nextInventoryCheckDelayMs() <= 200, true)
  assert.equal(OPEN_TIMEOUT_MS, 3_000)
})

test('random delay lấy giá trị ngẫu nhiên trong Min → Max và tự sửa thứ tự nhập ngược', () => {
  const { bot } = fakeBot()
  const controller = new AutoSellController(bot, () => {}, {
    autoSellRandomDelayEnabled: true,
    autoSellDelayMinSeconds: 4,
    autoSellDelayMaxSeconds: 2
  }, () => 0.25)

  assert.deepEqual(normalizeDelaySettings({
    autoSellRandomDelayEnabled: true,
    autoSellDelayMinSeconds: 4,
    autoSellDelayMaxSeconds: 2
  }), {
    randomEnabled: true,
    fixedMs: 200,
    minMs: 2_000,
    maxMs: 4_000,
    inventoryCheckMinMs: 100,
    inventoryCheckMaxMs: 200,
    quickAllMinMs: 50,
    quickAllMaxMs: 100,
    moveMinMs: 250,
    moveMaxMs: 400,
    guiTimeoutMs: 3_000,
    errorCooldownMs: 1_000,
    tickMs: 50
  })
  assert.equal(controller.nextCycleDelayMs(), 2_500)
})

test('Min–Max quét túi chỉnh được và tự đảo nếu nhập ngược', () => {
  const { bot } = fakeBot()
  const controller = new AutoSellController(bot, () => {}, {
    autoSellInventoryCheckDelayMinSeconds: 0.8,
    autoSellInventoryCheckDelayMaxSeconds: 0.5
  }, () => 0.25)

  assert.equal(controller.delaySettings.inventoryCheckMinMs, 500)
  assert.equal(controller.delaySettings.inventoryCheckMaxMs, 800)
  assert.equal(controller.nextInventoryCheckDelayMs(), 575)
})

test('mọi delay Auto Sell đều chỉnh được và các cặp Min–Max tự đảo', () => {
  const { bot } = fakeBot()
  const controller = new AutoSellController(bot, () => {}, {
    autoSellRandomDelayEnabled: true,
    autoSellDelayMinSeconds: 0.4,
    autoSellDelayMaxSeconds: 0.2,
    autoSellInventoryCheckDelayMinSeconds: 0.3,
    autoSellInventoryCheckDelayMaxSeconds: 0.1,
    autoSellQuickAllDelayMinSeconds: 0.12,
    autoSellQuickAllDelayMaxSeconds: 0.06,
    autoSellMoveDelayMinSeconds: 0.8,
    autoSellMoveDelayMaxSeconds: 0.4,
    autoSellGuiTimeoutSeconds: 4.5,
    autoSellErrorCooldownSeconds: 1.5,
    autoSellTickMilliseconds: 35
  }, () => 0.5)

  assert.deepEqual(controller.delaySettings, {
    randomEnabled: true,
    fixedMs: 200,
    minMs: 200,
    maxMs: 400,
    inventoryCheckMinMs: 100,
    inventoryCheckMaxMs: 300,
    quickAllMinMs: 60,
    quickAllMaxMs: 120,
    moveMinMs: 400,
    moveMaxMs: 800,
    guiTimeoutMs: 4_500,
    errorCooldownMs: 1_500,
    tickMs: 35
  })
  assert.equal(controller.nextCycleDelayMs(), 300)
  assert.equal(controller.nextInventoryCheckDelayMs(), 200)
  assert.equal(controller.nextQuickAllDelayMs(), 90)
  assert.equal(controller.nextMoveDelayMs(), 600)
})

test('GUI timeout, cooldown lỗi và nhịp xử lý lấy từ profile', async () => {
  const playerInventory = inventory({ 45: item(1) })
  const { bot } = fakeBot(null, playerInventory)
  const controller = new AutoSellController(bot, () => {}, {
    autoSellGuiTimeoutSeconds: 1.5,
    autoSellErrorCooldownSeconds: 2,
    autoSellTickMilliseconds: 25
  })
  arm(controller, STATES.CHECKING_INVENTORY)
  const before = Date.now()
  await controller.tick()
  assert.ok(controller.guiWaitDeadline - before >= 1_450)
  assert.ok(controller.guiWaitDeadline - before <= 1_600)
  assert.equal(controller.delaySettings.errorCooldownMs, 2_000)
  assert.equal(controller.delaySettings.tickMs, 25)
})

test('resume theo lý do không ghi đè pause của cơ chế khác', () => {
  const { bot } = fakeBot()
  const controller = new AutoSellController(bot)
  controller.start()
  controller.pause('Auto Home đang gửi lệnh')
  controller.pause('Bảo vệ vị trí')

  assert.equal(controller.resume('Auto Home đang gửi lệnh'), false)
  assert.equal(controller.paused, true)
  assert.equal(controller.resume('Bảo vệ vị trí'), true)
  controller.stop()
})
