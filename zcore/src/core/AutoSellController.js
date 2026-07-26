const TICK_MS = 50
const CHECK_INTERVAL_MS = 1_000
const OPEN_TIMEOUT_MS = 3_000
const INVENTORY_CHECK_DELAY_MIN_MS = 100
const INVENTORY_CHECK_DELAY_MAX_MS = 200
const QUICK_ALL_DELAY_MIN_MS = 50
const QUICK_ALL_DELAY_MAX_MS = 100
const MOVE_DELAY_MIN_MS = 250
const MOVE_DELAY_MAX_MS = 400
const CLOSE_DELAY_MS = 200
const CYCLE_DELAY_MIN_MS = 150
const CYCLE_DELAY_MAX_MS = 300
const TOTAL_SELL_SLOTS = 90
const PLAYER_SLOT_COUNT = 36
const SELL_COMMAND = '/sell'
const MIN_CONFIGURED_DELAY_MS = 50
const MAX_CONFIGURED_DELAY_MS = 60_000

const STATES = Object.freeze({
  IDLE: 'IDLE',
  CHECKING_INVENTORY: 'CHECKING_INVENTORY',
  SENDING_COMMAND: 'SENDING_COMMAND',
  WAITING_GUI: 'WAITING_GUI',
  MOVING_ITEMS: 'MOVING_ITEMS',
  WAITING_AFTER_MOVE: 'WAITING_AFTER_MOVE',
  CLOSING_GUI: 'CLOSING_GUI',
  WAITING_AFTER_SELL: 'WAITING_AFTER_SELL',
  ERROR_COOLDOWN: 'ERROR_COOLDOWN'
})

function serialized(value) {
  if (value == null) return ''
  try { return JSON.stringify(value) } catch { return String(value) }
}

function itemId(item) {
  if (!item) return ''
  if (item.name) return String(item.name)
  return String(item.type ?? '')
}

function delayMilliseconds(value, fallback = CLOSE_DELAY_MS) {
  const milliseconds = Number(value) * 1_000
  if (!Number.isFinite(milliseconds)) return fallback
  return Math.round(Math.min(MAX_CONFIGURED_DELAY_MS, Math.max(MIN_CONFIGURED_DELAY_MS, milliseconds)))
}

function tickMilliseconds(value, fallback = TICK_MS) {
  const milliseconds = Number(value)
  if (!Number.isFinite(milliseconds)) return fallback
  return Math.round(Math.min(1_000, Math.max(20, milliseconds)))
}

function normalizeDelaySettings(settings = {}) {
  const fixedMs = delayMilliseconds(settings.autoSellDelaySeconds, CLOSE_DELAY_MS)
  let minMs = delayMilliseconds(settings.autoSellDelayMinSeconds, CYCLE_DELAY_MIN_MS)
  let maxMs = delayMilliseconds(settings.autoSellDelayMaxSeconds, CYCLE_DELAY_MAX_MS)
  let inventoryCheckMinMs = delayMilliseconds(
    settings.autoSellInventoryCheckDelayMinSeconds,
    INVENTORY_CHECK_DELAY_MIN_MS
  )
  let inventoryCheckMaxMs = delayMilliseconds(
    settings.autoSellInventoryCheckDelayMaxSeconds,
    INVENTORY_CHECK_DELAY_MAX_MS
  )
  let quickAllMinMs = delayMilliseconds(
    settings.autoSellQuickAllDelayMinSeconds,
    QUICK_ALL_DELAY_MIN_MS
  )
  let quickAllMaxMs = delayMilliseconds(
    settings.autoSellQuickAllDelayMaxSeconds,
    QUICK_ALL_DELAY_MAX_MS
  )
  let moveMinMs = delayMilliseconds(
    settings.autoSellMoveDelayMinSeconds,
    MOVE_DELAY_MIN_MS
  )
  let moveMaxMs = delayMilliseconds(
    settings.autoSellMoveDelayMaxSeconds,
    MOVE_DELAY_MAX_MS
  )
  if (minMs > maxMs) [minMs, maxMs] = [maxMs, minMs]
  if (inventoryCheckMinMs > inventoryCheckMaxMs) {
    [inventoryCheckMinMs, inventoryCheckMaxMs] = [inventoryCheckMaxMs, inventoryCheckMinMs]
  }
  if (quickAllMinMs > quickAllMaxMs) [quickAllMinMs, quickAllMaxMs] = [quickAllMaxMs, quickAllMinMs]
  if (moveMinMs > moveMaxMs) [moveMinMs, moveMaxMs] = [moveMaxMs, moveMinMs]
  return {
    randomEnabled: settings.autoSellRandomDelayEnabled !== false,
    fixedMs,
    minMs,
    maxMs,
    inventoryCheckMinMs,
    inventoryCheckMaxMs,
    quickAllMinMs,
    quickAllMaxMs,
    moveMinMs,
    moveMaxMs,
    guiTimeoutMs: delayMilliseconds(settings.autoSellGuiTimeoutSeconds, OPEN_TIMEOUT_MS),
    errorCooldownMs: delayMilliseconds(settings.autoSellErrorCooldownSeconds, CHECK_INTERVAL_MS),
    tickMs: tickMilliseconds(settings.autoSellTickMilliseconds)
  }
}

function randomMilliseconds(random, minimum, maximum) {
  if (minimum === maximum) return minimum
  const ratio = Math.min(1, Math.max(0, Number(random()) || 0))
  return Math.round(minimum + ((maximum - minimum) * ratio))
}

// Equivalent to Minecraft's canItemQuickReplace(..., true):
// compare the item and its data/components, but ignore stack count.
function isSameQuickMoveItem(left, right) {
  if (!left || !right) return false
  return (
    left.type === right.type &&
    Number(left.metadata || 0) === Number(right.metadata || 0) &&
    serialized(left.nbt) === serialized(right.nbt) &&
    serialized(left.components || []) === serialized(right.components || []) &&
    serialized(left.removedComponents || []) === serialized(right.removedComponents || [])
  )
}

class AutoSellController {
  constructor(
    bot,
    emit = () => {},
    delaySettings = {},
    random = Math.random,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {
    this.bot = bot
    this.emit = typeof emit === 'function' ? emit : () => {}
    this.random = typeof random === 'function' ? random : Math.random
    this.sleep = typeof sleep === 'function'
      ? sleep
      : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    this.delaySettings = normalizeDelaySettings(delaySettings)
    this.running = false
    this.paused = false
    this.pauseReason = ''
    this.busy = false
    this.timer = null
    this.state = STATES.IDLE
    this.delayUntil = 0
    this.guiWaitDeadline = 0
    this.activeSellWindow = null
    this.movedItems = 0
    this.movedStacks = 0
    this.completedAt = 0
  }

  setDelaySettings(settings = {}) {
    const previousTickMs = this.delaySettings.tickMs
    this.delaySettings = normalizeDelaySettings(settings)
    if (this.running && previousTickMs !== this.delaySettings.tickMs) this.restartTimer()
  }

  nextCycleDelayMs() {
    const settings = this.delaySettings
    if (!settings.randomEnabled || settings.minMs === settings.maxMs) return settings.randomEnabled
      ? settings.minMs
      : settings.fixedMs
    return randomMilliseconds(this.random, settings.minMs, settings.maxMs)
  }

  nextInventoryCheckDelayMs() {
    return randomMilliseconds(
      this.random,
      this.delaySettings.inventoryCheckMinMs,
      this.delaySettings.inventoryCheckMaxMs
    )
  }

  nextQuickAllDelayMs() {
    return randomMilliseconds(
      this.random,
      this.delaySettings.quickAllMinMs,
      this.delaySettings.quickAllMaxMs
    )
  }

  nextMoveDelayMs() {
    return randomMilliseconds(this.random, this.delaySettings.moveMinMs, this.delaySettings.moveMaxMs)
  }

  restartTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), this.delaySettings.tickMs)
    this.timer.unref?.()
  }

  start() {
    this.running = true
    this.paused = false
    this.pauseReason = ''
    this.delayUntil = 0
    this.guiWaitDeadline = 0
    this.activeSellWindow = null
    this.movedItems = 0
    this.movedStacks = 0
    this.completedAt = 0
    this.setState(STATES.CHECKING_INVENTORY)
    if (!this.timer) this.restartTimer()
  }

  stop() {
    this.running = false
    this.paused = false
    this.pauseReason = ''
    this.delayUntil = 0
    this.guiWaitDeadline = 0
    this.activeSellWindow = null
    this.movedItems = 0
    this.movedStacks = 0
    this.completedAt = 0
    this.setState(STATES.IDLE)
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  pause(reason = '') {
    this.paused = true
    this.pauseReason = String(reason || '')
    this.emit('autosell', { state: this.state, paused: true, reason })
  }

  resume(expectedReason = '') {
    if (expectedReason && this.pauseReason !== expectedReason) return false
    this.paused = false
    this.pauseReason = ''
    this.emit('autosell', { state: this.state, paused: false })
    return true
  }

  setState(state, details = {}) {
    if (this.state === state && Object.keys(details).length === 0) return
    this.state = state
    this.emit('autosell', { state, paused: this.paused, ...details })
  }

  schedule(milliseconds) {
    this.delayUntil = Date.now() + Math.max(0, Number(milliseconds) || 0)
  }

  openInventory() {
    return this.bot.currentWindow || this.bot.inventory || null
  }

  inventoryHasItems() {
    try {
      const inventory = this.openInventory()
      if (!inventory || !Array.isArray(inventory.slots)) return false
      const total = inventory.slots.length
      const first = total - PLAYER_SLOT_COUNT
      const last = total - 1
      if (first < 0) return false
      for (let slot = first; slot <= last; slot += 1) {
        if (inventory.slots[slot]) return true
      }
    } catch {}
    return false
  }

  isSellGui(inventory) {
    return Boolean(
      inventory &&
      Array.isArray(inventory.slots) &&
      inventory.slots.length === TOTAL_SELL_SLOTS
    )
  }

  async tick() {
    if (!this.running || this.paused || this.busy || Date.now() < this.delayUntil) return
    this.busy = true
    try {
      if (this.state === STATES.CHECKING_INVENTORY) {
        await this.checkInventory()
      } else if (this.state === STATES.WAITING_GUI) {
        await this.waitForGui()
      } else if (this.state === STATES.WAITING_AFTER_MOVE) {
        await this.closeGui()
      } else if (this.state === STATES.WAITING_AFTER_SELL || this.state === STATES.ERROR_COOLDOWN) {
        this.setState(STATES.CHECKING_INVENTORY)
        await this.checkInventory()
      }
    } catch (error) {
      this.closeActiveSellGui()
      this.emit('log', { level: 'error', message: `Auto Sell: ${error.message}` })
      this.schedule(this.delaySettings.errorCooldownMs)
      this.setState(STATES.ERROR_COOLDOWN)
    } finally {
      this.busy = false
    }
  }

  async checkInventory() {
    if (!this.inventoryHasItems()) {
      this.schedule(this.nextInventoryCheckDelayMs())
      return
    }

    this.setState(STATES.SENDING_COMMAND)
    this.bot.chat(SELL_COMMAND)
    this.guiWaitDeadline = Date.now() + this.delaySettings.guiTimeoutMs
    this.activeSellWindow = null
    this.emit('log', { level: 'info', message: `Đã gửi ${SELL_COMMAND}, đang chờ GUI 90 slot...` })
    this.setState(STATES.WAITING_GUI)
  }

  async waitForGui() {
    const inventory = this.openInventory()
    if (this.isSellGui(inventory)) {
      this.activeSellWindow = inventory
      await this.moveInventoryItems(inventory)
      return
    }

    if (Date.now() - this.guiWaitDeadline >= 0) {
      this.schedule(this.nextInventoryCheckDelayMs())
      this.setState(STATES.CHECKING_INVENTORY)
    }
  }

  async quickAll(inventory, sourceSlot) {
    const sourceItem = inventory.slots[sourceSlot]
    if (!sourceItem) return { items: 0, stacks: 0 }

    const first = inventory.slots.length - PLAYER_SLOT_COUNT
    const last = inventory.slots.length - 1
    const matchingSlots = []
    for (let slot = first; slot <= last; slot += 1) {
      if (isSameQuickMoveItem(inventory.slots[slot], sourceItem)) matchingSlots.push(slot)
    }

    let items = 0
    let stacks = 0
    for (const slot of matchingSlots) {
      if (!this.running) return { items, stacks }
      if (this.bot.currentWindow !== inventory || !this.isSellGui(inventory)) {
        throw new Error('GUI 90 slot đã đóng trong lúc quickAll')
      }
      const currentItem = inventory.slots[slot]
      if (!isSameQuickMoveItem(currentItem, sourceItem)) continue
      items += Math.max(0, Number(currentItem.count) || 0)
      stacks += 1
      await this.bot.clickWindow(slot, 0, 1)
    }
    return { items, stacks }
  }

  async moveInventoryItems(inventory) {
    this.setState(STATES.MOVING_ITEMS)
    const total = inventory.slots.length
    const first = total - PLAYER_SLOT_COUNT
    const last = total - 1
    const moved = Object.create(null)
    let movedItems = 0
    let movedStacks = 0

    for (let slot = first; slot <= last; slot += 1) {
      const item = inventory.slots[slot]
      if (!item) continue
      const id = itemId(item)
      if (moved[id]) continue
      moved[id] = true
      const result = await this.quickAll(inventory, slot)
      movedItems += result.items
      movedStacks += result.stacks
      if (!this.running) return
      await this.sleep(this.nextQuickAllDelayMs())
    }

    if (!this.running) return
    this.movedItems = movedItems
    this.movedStacks = movedStacks
    this.schedule(this.nextMoveDelayMs())
    this.setState(STATES.WAITING_AFTER_MOVE, { movedItems, movedStacks })
  }

  closeActiveSellGui() {
    const inventory = this.activeSellWindow
    this.activeSellWindow = null
    if (!inventory || this.bot.currentWindow !== inventory || !this.isSellGui(inventory)) return false
    try {
      this.bot.closeWindow(inventory)
      return true
    } catch {
      return false
    }
  }

  async closeGui() {
    this.setState(STATES.CLOSING_GUI)
    const inventory = this.activeSellWindow
    if (this.bot.currentWindow && this.bot.currentWindow !== inventory) {
      throw new Error('GUI đã đổi trước khi đóng; không đóng nhầm cửa sổ khác')
    }
    this.closeActiveSellGui()

    const completed = this.movedStacks > 0
    this.completedAt = completed ? Date.now() : 0
    const nextDelayMs = this.nextCycleDelayMs()
    this.schedule(nextDelayMs)
    this.emit('log', {
      level: 'success',
      message: `Đã quickAll ${this.movedStacks} stack (${this.movedItems} vật phẩm) và đóng GUI bằng ESC.`
    })
    this.setState(STATES.WAITING_AFTER_SELL, {
      completed,
      completedAt: this.completedAt,
      movedItems: this.movedItems,
      movedStacks: this.movedStacks,
      nextDelayMs
    })
  }
}

module.exports = {
  AutoSellController,
  STATES,
  TICK_MS,
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
  MIN_CONFIGURED_DELAY_MS,
  MAX_CONFIGURED_DELAY_MS,
  tickMilliseconds,
  normalizeDelaySettings,
  randomMilliseconds,
  itemId,
  isSameQuickMoveItem
}
