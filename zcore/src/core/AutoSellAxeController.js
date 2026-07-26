const LEFT_CLICK_INTERVAL_MS = 100
const LOOK_UP_CHECK_INTERVAL_MS = 5 * 60 * 1_000
const LOOK_UP_PITCH_RADIANS = -Math.PI / 2
const LOOK_UP_TOLERANCE_RADIANS = Math.PI / 180

function normalizeAxeSettings(settings = {}) {
  return {
    enabled: settings.autoSellAxeEnabled === true,
    lookUpEnabled: settings.autoSellAxeLookUpEnabled !== false
  }
}

function isLookingStraightUp(bot) {
  if (!bot?.entity) return false
  if (typeof bot.zcoreIsLookingStraightUp === 'function') {
    return bot.zcoreIsLookingStraightUp()
  }
  const pitch = Number(bot.entity.pitch)
  return Number.isFinite(pitch) && Math.abs(pitch - LOOK_UP_PITCH_RADIANS) <= LOOK_UP_TOLERANCE_RADIANS
}

class AutoSellAxeController {
  constructor(bot, emit = () => {}, settings = {}) {
    this.bot = bot
    this.emit = typeof emit === 'function' ? emit : () => {}
    this.settings = normalizeAxeSettings(settings)
    this.running = false
    this.swingTimer = null
    this.lookTimer = null
    this.lookBusy = false
    this.lastSwingAt = 0
    this.lastLookCheckAt = 0
    this.lastLookCorrectionAt = 0
    this.swingErrorLogged = false
  }

  snapshot() {
    return {
      ...this.settings,
      running: this.running,
      leftClickHeld: this.running,
      lastSwingAt: this.lastSwingAt || null,
      lastLookCheckAt: this.lastLookCheckAt || null,
      lastLookCorrectionAt: this.lastLookCorrectionAt || null
    }
  }

  setSettings(settings = {}) {
    const previousLookUpEnabled = this.settings.lookUpEnabled
    this.settings = normalizeAxeSettings(settings)
    if (!this.running) return
    if (previousLookUpEnabled !== this.settings.lookUpEnabled) this.restartLookTimer()
    this.emit('autosellaxe', this.snapshot())
  }

  start() {
    if (this.running) return
    this.running = true
    this.restartSwingTimer()
    this.restartLookTimer()
    this.swing()
    this.emit('log', {
      level: 'success',
      message: 'Đã bật AutoSellAxe Member: giữ chuột trái liên tục và tự tiếp tục sau reconnect.'
    })
    this.emit('autosellaxe', this.snapshot())
  }

  stop() {
    this.running = false
    if (this.swingTimer) clearInterval(this.swingTimer)
    if (this.lookTimer) clearInterval(this.lookTimer)
    this.swingTimer = null
    this.lookTimer = null
    this.lookBusy = false
    this.emit('autosellaxe', this.snapshot())
  }

  restartSwingTimer() {
    if (this.swingTimer) clearInterval(this.swingTimer)
    this.swingTimer = setInterval(() => this.swing(), LEFT_CLICK_INTERVAL_MS)
    this.swingTimer.unref?.()
  }

  restartLookTimer() {
    if (this.lookTimer) clearInterval(this.lookTimer)
    this.lookTimer = null
    if (!this.running || !this.settings.lookUpEnabled) return
    this.lookTimer = setInterval(() => this.checkLook(), LOOK_UP_CHECK_INTERVAL_MS)
    this.lookTimer.unref?.()
  }

  swing() {
    if (!this.running || !this.bot) return false
    try {
      const result = typeof this.bot.zcoreSwingLeft === 'function'
        ? this.bot.zcoreSwingLeft()
        : this.bot.swingArm?.('right')
      if (result && typeof result.catch === 'function') {
        result.catch((error) => this.logSwingError(error))
      }
      this.lastSwingAt = Date.now()
      this.swingErrorLogged = false
      return true
    } catch (error) {
      this.logSwingError(error)
      return false
    }
  }

  logSwingError(error) {
    if (this.swingErrorLogged) return
    this.swingErrorLogged = true
    this.emit('log', {
      level: 'error',
      message: `AutoSellAxe không gửi được chuột trái: ${error?.message || error}`
    })
  }

  async checkLook() {
    if (!this.running || !this.settings.lookUpEnabled || !this.bot || this.lookBusy) return false
    this.lastLookCheckAt = Date.now()
    if (isLookingStraightUp(this.bot)) {
      this.emit('autosellaxe', this.snapshot())
      return false
    }

    this.lookBusy = true
    try {
      if (typeof this.bot.zcoreLookStraightUp === 'function') {
        await this.bot.zcoreLookStraightUp()
      } else if (typeof this.bot.look === 'function') {
        await this.bot.look(Number(this.bot.entity?.yaw) || 0, LOOK_UP_PITCH_RADIANS, true)
      } else {
        throw new Error('engine không hỗ trợ điều khiển góc nhìn')
      }
      this.lastLookCorrectionAt = Date.now()
      this.emit('log', { level: 'success', message: 'AutoSellAxe đã chỉnh góc nhìn thẳng lên trời.' })
      this.emit('autosellaxe', this.snapshot())
      return true
    } catch (error) {
      this.emit('log', {
        level: 'error',
        message: `AutoSellAxe không chỉnh được góc nhìn: ${error?.message || error}`
      })
      return false
    } finally {
      this.lookBusy = false
    }
  }
}

module.exports = {
  AutoSellAxeController,
  LEFT_CLICK_INTERVAL_MS,
  LOOK_UP_CHECK_INTERVAL_MS,
  LOOK_UP_PITCH_RADIANS,
  LOOK_UP_TOLERANCE_RADIANS,
  normalizeAxeSettings,
  isLookingStraightUp
}
