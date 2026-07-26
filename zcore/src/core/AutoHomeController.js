const HOME_COMMAND = '/home'
const MIN_HOME_NUMBER = 1
const MAX_HOME_NUMBER = 4
const DEFAULT_HOME_DELAY_MINUTES = 5
const MIN_HOME_DELAY_MINUTES = 1
const MAX_HOME_DELAY_MINUTES = 1_440
const SAFE_WINDOW_RETRY_MS = 1_000
const ERROR_RETRY_MAX_MS = 60_000

function numberInRange(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function normalizeHomeSettings(settings = {}) {
  const homeNumber = Math.round(numberInRange(
    settings.autoHomeNumber,
    MIN_HOME_NUMBER,
    MIN_HOME_NUMBER,
    MAX_HOME_NUMBER
  ))
  const delayMinutes = numberInRange(
    settings.autoHomeDelayMinutes,
    DEFAULT_HOME_DELAY_MINUTES,
    MIN_HOME_DELAY_MINUTES,
    MAX_HOME_DELAY_MINUTES
  )
  return {
    enabled: settings.autoHomeEnabled === true,
    homeNumber,
    delayMinutes,
    delayMs: Math.round(delayMinutes * 60_000)
  }
}

class AutoHomeController {
  constructor(bot, emit = () => {}, settings = {}, hooks = {}) {
    this.bot = bot
    this.emit = typeof emit === 'function' ? emit : () => {}
    this.canSend = typeof hooks.canSend === 'function' ? hooks.canSend : () => true
    this.beforeSend = typeof hooks.beforeSend === 'function' ? hooks.beforeSend : () => null
    this.afterSend = typeof hooks.afterSend === 'function' ? hooks.afterSend : () => {}
    this.settings = normalizeHomeSettings(settings)
    this.running = false
    this.timer = null
    this.nextSendAt = 0
    this.lastSentAt = 0
    this.waitingForSafeWindow = false
  }

  setSettings(settings = {}) {
    const wasRunning = this.running
    this.settings = normalizeHomeSettings(settings)
    if (!this.settings.enabled) {
      this.stop()
    } else if (wasRunning) {
      this.schedule(this.settings.delayMs)
    }
    return this.settings
  }

  start() {
    if (!this.settings.enabled) return false
    this.running = true
    this.waitingForSafeWindow = false
    this.schedule(this.settings.delayMs)
    return true
  }

  stop() {
    this.running = false
    this.waitingForSafeWindow = false
    this.nextSendAt = 0
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  schedule(milliseconds) {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    const delayMs = Math.max(0, Math.round(Number(milliseconds) || 0))
    this.nextSendAt = Date.now() + delayMs
    this.timer = setTimeout(() => {
      this.timer = null
      void this.trySend()
    }, delayMs)
    this.timer.unref?.()
  }

  command() {
    return `${HOME_COMMAND} ${this.settings.homeNumber}`
  }

  snapshot() {
    return {
      enabled: this.settings.enabled,
      running: this.running,
      homeNumber: this.settings.homeNumber,
      delayMinutes: this.settings.delayMinutes,
      nextSendAt: this.nextSendAt || null,
      lastSentAt: this.lastSentAt || null,
      waitingForSafeWindow: this.waitingForSafeWindow
    }
  }

  async trySend() {
    if (!this.running || !this.settings.enabled) return false

    let safe = false
    try {
      safe = await this.canSend()
    } catch (error) {
      this.emit('log', { level: 'warn', message: `Auto Home chưa kiểm tra được trạng thái: ${error.message}` })
    }
    if (!safe) {
      this.waitingForSafeWindow = true
      this.schedule(SAFE_WINDOW_RETRY_MS)
      return false
    }

    this.waitingForSafeWindow = false
    const command = this.command()
    let context = null
    let sent = false
    try {
      context = await this.beforeSend(command)
      this.bot.chat(command)
      sent = true
      this.lastSentAt = Date.now()
      this.emit('log', {
        level: 'success',
        message: `Auto Home đã gửi ${command}; lần kế tiếp sau ${this.settings.delayMinutes} phút.`
      })
      this.emit('autohome', {
        sent: true,
        command,
        sentAt: this.lastSentAt,
        homeNumber: this.settings.homeNumber,
        delayMinutes: this.settings.delayMinutes
      })
      this.schedule(this.settings.delayMs)
      return true
    } catch (error) {
      this.emit('log', { level: 'error', message: `Auto Home: ${error.message}` })
      this.schedule(Math.min(this.settings.delayMs, ERROR_RETRY_MAX_MS))
      return false
    } finally {
      try {
        await this.afterSend({ sent, command, context })
      } catch (error) {
        this.emit('log', { level: 'warn', message: `Auto Home không khôi phục được Auto Sell: ${error.message}` })
      }
    }
  }
}

module.exports = {
  AutoHomeController,
  HOME_COMMAND,
  MIN_HOME_NUMBER,
  MAX_HOME_NUMBER,
  DEFAULT_HOME_DELAY_MINUTES,
  MIN_HOME_DELAY_MINUTES,
  MAX_HOME_DELAY_MINUTES,
  SAFE_WINDOW_RETRY_MS,
  ERROR_RETRY_MAX_MS,
  normalizeHomeSettings
}
