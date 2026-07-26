const path = require('node:path')
const { AutoSellController, STATES } = require('./AutoSellController')
const { AutoSellAxeController, normalizeAxeSettings } = require('./AutoSellAxeController')
const { AutoHomeController, normalizeHomeSettings } = require('./AutoHomeController')
const { StatsTracker } = require('./StatsTracker')
const { postWebhook, statsPayload, alertPayload } = require('./DiscordWebhook')
const { createProxyConnect } = require('./ProxyConnector')
const { ClientTickSync } = require('./ClientTickSync')
const { BalanceTracker, parseBalanceCommandResponse } = require('./BalanceTracker')
const { createProtocolBot } = require('./ProtocolBot')
const {
  PROFILE_NOT_FOUND,
  AUTH_REJECTED,
  AUTH_UNAVAILABLE,
  microsoftAuthenticator
} = require('./MicrosoftAuthenticator')

function reconnectDelay(profile, failedAttempts) {
  const base = Math.max(1, Number(profile.reconnectDelaySeconds) || 10)
  const maximum = Math.max(base, Number(profile.reconnectMaxDelaySeconds) || 60)
  return Math.min(maximum, base * (2 ** Math.min(4, Math.max(0, failedAttempts))))
}

function authReconnectDelay(failedAttempts) {
  return Math.min(
    AUTH_RECONNECT_MAX_SECONDS,
    AUTH_RECONNECT_BASE_SECONDS * (2 ** Math.min(4, Math.max(0, Number(failedAttempts) || 0)))
  )
}

function errorText(value) {
  const parts = []
  let current = value
  for (let depth = 0; current && depth < 4; depth += 1) {
    const message = String(current?.message || current || '').trim()
    if (message && !parts.includes(message)) parts.push(message)
    current = current?.cause
  }
  return parts.join(' — ')
}

function connectionFailureInfo(value, { phase = '', hasAuthenticatedBefore = false } = {}) {
  if (value?.kind && typeof value.retryable === 'boolean') return value
  const detail = errorText(value)
  const lower = detail.toLowerCase()
  const code = String(value?.code || value?.cause?.code || '').toUpperCase()

  if (code === PROFILE_NOT_FOUND) {
    return {
      kind: 'account',
      retryable: false,
      message: 'Tài khoản Microsoft này không có hồ sơ Minecraft Java.',
      detail
    }
  }
  if (code === AUTH_REJECTED) {
    return {
      kind: 'auth-service',
      retryable: value?.retryable !== false,
      message: 'Minecraft đang từ chối phiên đăng nhập đã lưu; ZCore sẽ giữ token và thử lại.',
      detail
    }
  }
  if (
    code === AUTH_UNAVAILABLE ||
    /failed to obtain profile data|does the account own minecraft/.test(lower)
  ) {
    return {
      kind: 'auth-service',
      retryable: true,
      message: hasAuthenticatedBefore
        ? 'Dịch vụ xác thực Minecraft tạm thời không trả về profile; tài khoản đã từng vào server nên không phải lỗi “chưa mua game”.'
        : 'Chưa lấy được profile Minecraft; có thể dịch vụ xác thực hoặc mạng đang gián đoạn.',
      detail
    }
  }

  const networkFailure = (
    /fetch failed|cannot reach authentication servers|authentication servers may be down|client timed out|timed out|timeout|socket hang up|network is unreachable|temporary failure in name resolution/.test(lower) ||
    ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
  )
  if (networkFailure) {
    const authenticating = phase === 'authenticating' || phase === 'reconnecting'
    return {
      kind: authenticating ? 'auth-service' : 'network',
      retryable: true,
      message: authenticating
        ? 'Mạng hoặc máy chủ xác thực Microsoft/Minecraft đang không phản hồi.'
        : 'Kết nối mạng tới server đã bị gián đoạn hoặc hết thời gian chờ.',
      detail
    }
  }

  return {
    kind: 'connection',
    retryable: true,
    message: detail || 'Kết nối đã bị ngắt.',
    detail
  }
}

function failureLogMessage(failure) {
  if (failure.kind === 'account') return `Lỗi tài khoản: ${failure.message}`
  if (failure.kind === 'auth-service') return `Xác thực tạm thời gián đoạn: ${failure.message}`
  if (failure.kind === 'network') return `Lỗi mạng: ${failure.message}`
  return `Lỗi kết nối: ${failure.message}`
}

function normalizeChatInput(text) {
  const value = String(text || '').trim()
  if (!value || value.length > 256) throw new Error('Lệnh trống hoặc quá dài')
  return value
}

function isBalanceCommand(text) {
  return /^\/balance\s*$/i.test(String(text || '').trim())
}

function webhookIntervalMs(profile) {
  const minutes = Number(profile?.discordWebhookIntervalMinutes)
  const safeMinutes = Number.isFinite(minutes) ? Math.min(1440, Math.max(1, minutes)) : 60
  return Math.round(safeMinutes * 60_000)
}

function webhookNoSellMs(profile) {
  const minutes = Number(profile?.webhookNoSellMinutes)
  const safeMinutes = Number.isFinite(minutes) ? Math.min(1440, Math.max(1, minutes)) : 5
  return Math.round(safeMinutes * 60_000)
}

function strangerActionLabel(action) {
  return ({
    notify: 'Chỉ thông báo, tiếp tục Auto Sell',
    pause: 'Tạm dừng Auto Sell',
    disconnect: 'Thoát game'
  })[action] || 'Chỉ thông báo, tiếp tục Auto Sell'
}

function afkRuntimeOptions(profile) {
  const enabled = profile?.afkLiteEnabled !== false
  return {
    physicsEnabled: !enabled,
    viewDistance: enabled ? 2 : 'far',
    maxCatchupTicks: enabled ? 1 : 4,
    defaultChatPatterns: !enabled,
    colorsEnabled: !enabled
  }
}

// Packet entity/player chỉ cần khi có cơ chế thật sự đọc bot.players. Bảo vệ
// vị trí dùng bot.entity.position (packet `position`) nên không tính vào đây.
function playerTrackingEnabled(profile) {
  return profile?.whitelistGuardEnabled === true || profile?.webhookStrangerAlertEnabled === true
}

function createBotForProfile(profile, options) {
  if (profile?.clientEngine === 'mineflayer') {
    const mineflayer = require('mineflayer')
    return mineflayer.createBot(options)
  }
  return createProtocolBot({
    ...options,
    viewDistance: profile?.afkLiteEnabled === false ? 8 : 2,
    colorsEnabled: profile?.afkLiteEnabled === false,
    balanceScoreboardEnabled: (
      profile?.balanceTrackingEnabled !== false &&
      profile?.balanceCommandEnabled === false
    ),
    playerTrackingEnabled: playerTrackingEnabled(profile)
  })
}

function profileStaggerOffset(profileId, windowMs) {
  const maximum = Math.max(0, Math.floor(Number(windowMs) || 0))
  if (maximum <= 0) return 0
  let hash = 2166136261
  for (const character of String(profileId || 'zcore')) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % maximum
}

const LOG_CACHE_LIMIT = 100
const RUNTIME_STATE_INTERVAL_MS = 5_000
const HEADLESS_RUNTIME_STATE_INTERVAL_MS = 30_000
const PROTECTION_INTERVAL_MS = 1_000
const ACTIONBAR_LOG_INTERVAL_MS = 2_000
const BALANCE_COMMAND_INTERVAL_MS = 30_000
const BALANCE_COMMAND_INITIAL_DELAY_MS = 2_000
const BALANCE_COMMAND_STAGGER_WINDOW_MS = 8_000
const BALANCE_COMMAND_RESPONSE_TIMEOUT_MS = 15_000
const RECONNECT_STAGGER_WINDOW_MS = 8_000
const WEBHOOK_STAGGER_WINDOW_MS = 30_000
const NETWORK_WATCHDOG_INTERVAL_MS = 15_000
const AUTH_RECONNECT_BASE_SECONDS = 30
const AUTH_RECONNECT_MAX_SECONDS = 300
const AUTO_HOME_AUTOSELL_PAUSE_MS = 3_000
const AUTO_HOME_PAUSE_REASON = 'Auto Home đang gửi lệnh'
const STRANGER_PAUSE_REASON = 'Phát hiện người lạ'
const DEATH_ALERT_COOLDOWN_MS = 5_000
const AUTO_HOME_BLOCKED_STATES = new Set([
  STATES.SENDING_COMMAND,
  STATES.WAITING_GUI,
  STATES.MOVING_ITEMS,
  STATES.WAITING_AFTER_MOVE,
  STATES.CLOSING_GUI
])

class BotSession {
  constructor(profile, authRoot, emit = () => {}, persistStats = () => {}, fileLogger = null, options = {}) {
    this.profile = profile
    this.authRoot = authRoot
    this.emit = emit
    this.persistStats = persistStats
    this.fileLogger = fileLogger
    this.retainLogs = options.retainLogs !== false
    this.bot = null
    this.controller = null
    this.axeController = null
    this.homeController = null
    this.status = 'offline'
    this.manualStop = true
    this.blockedByProtection = false
    this.resourceSavingMode = false
    this.reconnectTimer = null
    this.connectionTimer = null
    this.authTimer = null
    this.clientTickSync = null
    this.runtimeTimer = null
    this.reportTimer = null
    this.reportInitialTimer = null
    this.noSellTimer = null
    this.protectionTimer = null
    this.balanceCommandTimer = null
    this.balanceCommandInitialTimer = null
    this.stableTimer = null
    this.networkWatchdogTimer = null
    this.autoHomeResumeTimer = null
    this.networkStallTriggered = false
    this.origin = null
    this.wasDisplaced = false
    this.lastError = null
    this.lastConnectionError = null
    this.hasAuthenticatedBefore = false
    this.generation = 0
    this.failedAttempts = 0
    this.authFailedAttempts = 0
    this.connectedAt = 0
    this.lastPacketAt = 0
    this.packetCount = 0
    this.lastBalanceCommandAt = 0
    this.balanceResponseDeadlineAt = 0
    this.lastBalanceResponseAt = 0
    this.lastBalanceRequestError = null
    this.saleSequence = 0
    this.lastConfirmedSaleAt = 0
    this.lastConfirmedSaleId = null
    this.lastNoSellAlertAt = 0
    this.lastActionbarLogAt = 0
    this.lastDeathAlertAt = 0
    this.lastKnownUsername = null
    this.webhookInFlight = false
    this.webhookQueue = Promise.resolve()
    this.nearbyStrangers = new Set()
    this.whitelist = new Set((profile.whitelistedPlayers || []).map((value) => String(value).toLowerCase()))
    this.logs = []
    this.stats = new StatsTracker((snapshot) => {
      this.persistStats(snapshot)
      this.emitState()
    })
    this.balanceTracker = new BalanceTracker(() => this.emitState())
  }

  log(message, level = 'info', error = null) {
    const entry = { time: Date.now(), level, message: String(message) }
    if (this.retainLogs) {
      this.logs.push(entry)
      if (this.logs.length > LOG_CACHE_LIMIT) this.logs.splice(0, this.logs.length - LOG_CACHE_LIMIT)
    }
    this.fileLogger?.write(this.profile.id, level, message, error)
    this.emit('log', entry)
  }

  snapshot(includeLogs = true) {
    const snapshot = {
      profileId: this.profile.id,
      status: this.status,
      username: this.bot?.username || null,
      autoSellState: this.controller?.state || STATES.IDLE,
      autoSellPaused: this.controller?.paused || false,
      autoSellAxe: this.axeController?.snapshot() || {
        ...normalizeAxeSettings(this.profile),
        running: false,
        leftClickHeld: false,
        lastSwingAt: null,
        lastLookCheckAt: null,
        lastLookCorrectionAt: null
      },
      autoHome: this.homeController?.snapshot() || {
        ...normalizeHomeSettings(this.profile),
        running: false,
        nextSendAt: null,
        lastSentAt: null,
        waitingForSafeWindow: false
      },
      blockedByProtection: this.blockedByProtection,
      lastError: this.lastError,
      network: {
        connectedAt: this.connectedAt || null,
        lastPacketAt: this.lastPacketAt || null,
        packetCount: this.packetCount,
        failedAttempts: this.failedAttempts,
        authFailedAttempts: this.authFailedAttempts
      },
      stats: this.stats.snapshot(),
      balance: this.balanceSnapshot()
    }
    snapshot.clientEngine = this.profile.clientEngine === 'mineflayer' ? 'mineflayer' : 'protocol'
    if (includeLogs) snapshot.logs = this.logs.slice(-LOG_CACHE_LIMIT)
    return snapshot
  }

  emitState() {
    this.emit('state', this.snapshot(false))
  }

  balanceSnapshot(now = Date.now()) {
    const hasUnansweredRequest = this.lastBalanceCommandAt > this.lastBalanceResponseAt
    return {
      ...this.balanceTracker.snapshot(),
      trackingEnabled: this.profile.balanceTrackingEnabled !== false,
      commandEnabled: this.profile.balanceCommandEnabled !== false,
      requestPending: hasUnansweredRequest && this.balanceResponseDeadlineAt > now,
      requestTimedOut: hasUnansweredRequest && this.balanceResponseDeadlineAt > 0 && this.balanceResponseDeadlineAt <= now,
      lastRequestedAt: this.lastBalanceCommandAt || null,
      lastResponseAt: this.lastBalanceResponseAt || null,
      responseTimeoutMs: BALANCE_COMMAND_RESPONSE_TIMEOUT_MS,
      lastRequestError: this.lastBalanceRequestError
    }
  }

  isBalanceRequestPending(now = Date.now()) {
    return this.lastBalanceCommandAt > this.lastBalanceResponseAt && this.balanceResponseDeadlineAt > now
  }

  markBalanceRequest(at = Date.now()) {
    this.lastBalanceCommandAt = Math.max(Number(at) || Date.now(), this.lastBalanceResponseAt + 1)
    this.balanceResponseDeadlineAt = this.lastBalanceCommandAt + BALANCE_COMMAND_RESPONSE_TIMEOUT_MS
    this.lastBalanceRequestError = null
    this.emitState()
  }

  acceptBalanceResponse(message, source = 'balance-command') {
    if (!this.isBalanceRequestPending()) return null
    const amount = parseBalanceCommandResponse(message)
    if (amount === null) return null
    this.lastBalanceResponseAt = Math.max(Date.now(), this.lastBalanceCommandAt)
    this.balanceResponseDeadlineAt = 0
    this.lastBalanceRequestError = null
    this.balanceTracker.update(amount, source)
    this.emitState()
    return amount
  }

  clearBalanceRequest() {
    this.balanceResponseDeadlineAt = 0
    this.lastBalanceRequestError = null
  }

  shouldProcessIncomingMessage(now = Date.now()) {
    if (this.profile.consoleEnabled && !this.resourceSavingMode) return true
    if (this.profile.balanceTrackingEnabled !== false) {
      if (this.isBalanceRequestPending(now) || this.profile.balanceCommandEnabled === false) return true
    }
    if (!this.profile.statsEnabled || !this.lastConfirmedSaleAt) return false
    return now - this.lastConfirmedSaleAt <= 12_000
  }

  isCurrent(bot, generation) {
    return this.bot === bot && this.generation === generation
  }

  start() {
    if (['connecting', 'online', 'reconnecting', 'authenticating'].includes(this.status)) return
    if (!this.profile.host) throw new Error('Hãy nhập địa chỉ server')
    this.manualStop = false
    this.blockedByProtection = false
    this.lastError = null
    this.lastConnectionError = null
    this.failedAttempts = 0
    this.authFailedAttempts = 0
    this.lastBalanceCommandAt = 0
    this.balanceResponseDeadlineAt = 0
    this.lastBalanceResponseAt = 0
    this.lastBalanceRequestError = null
    this.saleSequence = 0
    this.lastConfirmedSaleAt = 0
    this.lastConfirmedSaleId = null
    this.lastNoSellAlertAt = 0
    this.lastActionbarLogAt = 0
    this.lastDeathAlertAt = 0
    this.nearbyStrangers.clear()
    this.stats.reset()
    this.balanceTracker.reset()
    this.connect(false)
  }

  connect(isReconnect) {
    if (this.manualStop || this.blockedByProtection) return
    this.clearReconnectTimer()
    this.clearConnectionTimers()
    const generation = ++this.generation
    this.status = isReconnect ? 'reconnecting' : 'authenticating'
    this.connectedAt = 0
    this.lastPacketAt = 0
    this.packetCount = 0
    this.networkStallTriggered = false
    this.lastConnectionError = null
    this.clearBalanceRequest()
    this.emitState()
    this.log(isReconnect ? 'Đang kết nối lại...' : 'Đang đăng nhập Microsoft...')

    const profileFolder = path.join(this.authRoot, this.profile.id)
    const accountKey = this.profile.microsoftAccount || `zcore-${this.profile.id}`
    let proxyConnect
    try {
      proxyConnect = createProxyConnect(this.profile, (message) => this.log(message, 'network'))
    } catch (error) {
      this.handleCreateError(error)
      return
    }

    let bot
    try {
      bot = createBotForProfile(this.profile, {
        host: this.profile.host,
        port: Number(this.profile.port) || 25565,
        username: accountKey,
        auth: microsoftAuthenticator,
        version: '1.21.11',
        profilesFolder: profileFolder,
        onMsaCode: (code) => this.handleMicrosoftCode(code),
        hideErrors: true,
        ...afkRuntimeOptions(this.profile),
        connect: proxyConnect || undefined
      })
      this.bot = bot
      bot.shouldProcessMessage = () => this.shouldProcessIncomingMessage()
      this.balanceTracker.attach(bot, {
        pollScoreboard: this.profile.balanceTrackingEnabled !== false && this.profile.balanceCommandEnabled === false
      })
    } catch (error) {
      this.handleCreateError(error)
      return
    }

    const client = bot._client
    client.once('session', () => {
      if (!this.isCurrent(bot, generation)) return
      this.hasAuthenticatedBefore = true
      this.authFailedAttempts = 0
    })
    client.once('connect', () => {
      if (!this.isCurrent(bot, generation)) return
      if (this.authTimer) clearTimeout(this.authTimer)
      this.authTimer = null
      this.connectedAt = Date.now()
      this.lastPacketAt = this.connectedAt
      const socket = client.socket
      try {
        socket?.setNoDelay?.(true)
        socket?.setKeepAlive?.(true, Math.max(5, Number(this.profile.tcpKeepAliveDelaySeconds) || 30) * 1000)
        socket?.on?.('data', () => {
          if (!this.isCurrent(bot, generation)) return
          this.lastPacketAt = Date.now()
          this.packetCount += 1
        })
        this.log(`TCP đã kết nối tới ${this.profile.host}:${this.profile.port}; keep-alive đã bật.`, 'network')
      } catch (error) {
        this.log(`Không bật được TCP keep-alive: ${error.message}`, 'warn', error)
      }
      this.armJoinTimeout(bot, generation, client)
    })

    bot.once('login', () => {
      if (!this.isCurrent(bot, generation)) return
      this.hasAuthenticatedBefore = true
      this.authFailedAttempts = 0
      this.status = 'connecting'
      this.log(`Đã xác thực Microsoft với ${bot.username || accountKey}.`)
      this.emitState()
    })

    bot.once('spawn', () => {
      if (!this.isCurrent(bot, generation)) return
      this.clearConnectionTimers()
      this.status = 'online'
      this.lastKnownUsername = bot.username || accountKey
      this.connectedAt ||= Date.now()
      this.lastPacketAt ||= Date.now()
      this.origin = bot.entity?.position?.clone() || null
      this.wasDisplaced = false
      this.failedAttempts = 0
      this.authFailedAttempts = 0
      this.networkStallTriggered = false
      this.nearbyStrangers.clear()
      this.lastError = null
      this.log(`Đã vào ${this.profile.host}:${this.profile.port} — Minecraft 1.21.11.`, 'success')
      this.log(this.profile.clientEngine === 'mineflayer'
        ? 'Engine: Mineflayer tương thích (dùng nhiều tài nguyên hơn).'
        : 'Engine: Protocol Max — chỉ giữ chat, inventory, GUI Sell, keepalive và tick_end.',
      'network')
      if (this.profile.afkLiteEnabled !== false) {
        this.log('AFK Max đang bật: physics mô phỏng tắt, view distance 2 chunk, chat pattern tối giản.', 'network')
      }
      this.controller = new AutoSellController(bot, (type, payload) => {
        if (
          type === 'autosell' &&
          payload?.state === STATES.WAITING_AFTER_SELL &&
          payload?.completed === true
        ) this.markConfirmedSale(payload.completedAt)
        const importantLog = type === 'log' && ['warn', 'error'].includes(payload?.level)
        if (type === 'log' && (!this.resourceSavingMode || importantLog)) this.log(payload.message, payload.level)
        if (!this.resourceSavingMode || importantLog || payload?.paused === true) this.emitState()
      }, this.profile)
      if (this.profile.autoSellEnabled) this.controller.start()
      this.axeController = new AutoSellAxeController(bot, (type, payload) => {
        const importantLog = type === 'log' && ['warn', 'error'].includes(payload?.level)
        if (type === 'log' && (!this.resourceSavingMode || importantLog)) this.log(payload.message, payload.level)
        if (!this.resourceSavingMode || importantLog) this.emitState()
      }, this.profile)
      if (this.profile.autoSellAxeEnabled) this.axeController.start()
      this.homeController = new AutoHomeController(bot, (type, payload) => {
        const importantLog = type === 'log' && ['warn', 'error'].includes(payload?.level)
        if (type === 'log' && (!this.resourceSavingMode || importantLog)) this.log(payload.message, payload.level)
        if (type === 'autohome' && !this.resourceSavingMode) this.emitState()
      }, this.profile, {
        canSend: () => this.canSendAutoHome(bot, generation),
        beforeSend: () => this.pauseAutoSellForHome(),
        afterSend: (result) => this.resumeAutoSellAfterHome(result)
      })
      if (this.profile.autoHomeEnabled) this.homeController.start()
      this.clientTickSync = new ClientTickSync(
        client,
        () => this.isCurrent(bot, generation) && this.status === 'online',
        (error) => this.log(`Không gửi được tick_end 1.21.11: ${error.message}`, 'error', error)
      )
      this.clientTickSync.start()
      this.log('Đã bật đồng bộ tick_end Minecraft 1.21.11 (20 TPS).', 'network')
      this.startRuntimeTimers()
      this.stableTimer = setTimeout(() => {
        if (this.isCurrent(bot, generation) && this.status === 'online') this.failedAttempts = 0
      }, 60_000)
      this.emitState()
    })

    bot.on('messagestr', (message, position) => {
      if (!this.isCurrent(bot, generation)) return
      const overlay = position === 'game_info' || position === 2
      if (this.profile.consoleEnabled && !this.resourceSavingMode) {
        const now = Date.now()
        if (!overlay || this.profile.afkLiteEnabled === false || now - this.lastActionbarLogAt >= ACTIONBAR_LOG_INTERVAL_MS) {
          this.log(message, overlay ? 'actionbar' : 'chat')
          if (overlay) this.lastActionbarLogAt = now
        }
      }
      if (this.controller?.completedAt > this.lastConfirmedSaleAt) this.markConfirmedSale(this.controller.completedAt)
      if (this.profile.balanceTrackingEnabled !== false) {
        const waitingForBalance = this.isBalanceRequestPending()
        if (waitingForBalance) this.acceptBalanceResponse(message)
        else if (!this.profile.balanceCommandEnabled) {
          this.balanceTracker.observeText(message, overlay ? 'actionbar' : 'chat')
        }
      }
      if (this.profile.statsEnabled) {
        const saleAgeMs = this.lastConfirmedSaleAt ? Date.now() - this.lastConfirmedSaleAt : Number.POSITIVE_INFINITY
        if (saleAgeMs <= 12_000) {
          const amount = this.stats.parseMessage(message, overlay, {
            saleContext: true,
            saleAgeMs,
            saleId: this.lastConfirmedSaleId
          })
          if (amount !== null) this.log(`Ghi nhận lượt bán +${StatsTracker.formatCurrency(amount)}.`, 'money')
        }
      }
    })

    bot.on('death', () => {
      if (!this.isCurrent(bot, generation)) return
      const now = Date.now()
      if (now - this.lastDeathAlertAt < DEATH_ALERT_COOLDOWN_MS) return
      this.lastDeathAlertAt = now
      this.log('Nhân vật đã chết.', 'warn')
      if (this.profile.webhookDeathAlertEnabled) this.sendAlertWebhook('death')
    })

    bot.on('kicked', (reason) => {
      if (!this.isCurrent(bot, generation)) return
      const text = typeof reason === 'string' ? reason : JSON.stringify(reason)
      this.log(`Bị kick: ${text}`, 'warn')
    })

    bot.on('error', (error) => this.handleBotError(bot, generation, error))

    bot.once('end', (reason) => this.handleEnd(bot, generation, reason))

    const authTimeoutSeconds = Math.max(180, Number(this.profile.authenticationTimeoutSeconds) || 600)
    this.authTimer = setTimeout(() => {
      if (!this.isCurrent(bot, generation) || this.connectedAt || this.status === 'online') return
      const message = `Đăng nhập Microsoft quá ${authTimeoutSeconds} giây`
      this.handleBotError(bot, generation, new Error(message))
    }, authTimeoutSeconds * 1000)
  }

  armJoinTimeout(bot, generation, client) {
    if (this.connectionTimer) clearTimeout(this.connectionTimer)
    const timeoutSeconds = Math.max(15, Number(this.profile.connectionTimeoutSeconds) || 45)
    this.connectionTimer = setTimeout(() => {
      if (!this.isCurrent(bot, generation) || this.status === 'online') return
      const message = `TCP đã kết nối nhưng quá ${timeoutSeconds} giây vẫn chưa vào server`
      this.lastError = message
      this.log(message, 'error')
      try { client.end('ZCore connection timeout') } catch {}
      setTimeout(() => {
        if (this.isCurrent(bot, generation) && this.status !== 'online') {
          try { client.socket?.destroy() } catch {}
        }
      }, 2_000)
    }, timeoutSeconds * 1000)
  }

  handleMicrosoftCode(code) {
    const payload = typeof code === 'object' && code ? code : { message: String(code) }
    const userCode = payload.user_code || payload.userCode || ''
    const verificationUri = payload.verification_uri || payload.verificationUri || 'https://www.microsoft.com/link'
    this.log(userCode ? `Nhập mã Microsoft: ${userCode}` : (payload.message || 'Cần xác thực Microsoft.'), 'auth')
    this.emit('auth-code', { userCode, verificationUri, message: payload.message || '' })
  }

  handleBotError(bot, generation, error) {
    if (!this.isCurrent(bot, generation)) return
    const phase = this.status
    const failure = connectionFailureInfo(error, {
      phase,
      hasAuthenticatedBefore: this.hasAuthenticatedBefore
    })
    this.lastConnectionError = error
    this.lastError = failure.message
    this.log(failureLogMessage(failure), failure.retryable ? 'warn' : 'error', error)
    this.emitState()

    const failedBeforeTcp = (
      !this.connectedAt &&
      (phase === 'authenticating' || phase === 'reconnecting')
    )
    if (!failedBeforeTcp) return

    this.bot = null
    this.balanceTracker.detach()
    this.clearBalanceRequest()
    this.clearConnectionTimers()
    try { bot._client?.end?.('ZCore pre-connect failure') } catch {}
    try { bot._client?.socket?.destroy?.() } catch {}
    this.failedAttempts += 1
    this.scheduleReconnect(failure)
  }

  handleCreateError(error) {
    const failure = connectionFailureInfo(error, {
      phase: this.status,
      hasAuthenticatedBefore: this.hasAuthenticatedBefore
    })
    this.lastConnectionError = error
    this.lastError = failure.message
    this.log(`Không thể tạo bot: ${failure.message}`, failure.retryable ? 'warn' : 'error', error)
    this.failedAttempts += 1
    this.scheduleReconnect(failure)
  }

  handleEnd(bot, generation, reason) {
    if (!this.isCurrent(bot, generation)) {
      this.fileLogger?.write(this.profile.id, 'network', 'Bỏ qua sự kiện ngắt của phiên kết nối cũ')
      return
    }
    const wasOnline = this.status === 'online'
    const failure = connectionFailureInfo(this.lastConnectionError || reason, {
      phase: this.status,
      hasAuthenticatedBefore: this.hasAuthenticatedBefore
    })
    const uptime = this.connectedAt ? Date.now() - this.connectedAt : 0
    const lastPacketAgo = this.lastPacketAt ? Date.now() - this.lastPacketAt : -1
    if (
      wasOnline &&
      !this.manualStop &&
      !this.blockedByProtection &&
      this.profile.webhookOfflineAlertEnabled
    ) {
      this.sendAlertWebhook('offline', { reason: errorText(reason) || 'Mất kết nối không xác định' }, bot.username)
    }
    this.bot = null
    this.balanceTracker.detach()
    this.clearBalanceRequest()
    this.clearConnectionTimers()
    this.clientTickSync?.stop()
    this.clientTickSync = null
    this.controller?.stop()
    this.controller = null
    this.axeController?.stop()
    this.axeController = null
    this.homeController?.stop()
    this.homeController = null
    this.lastConnectionError = null
    this.stopRuntimeTimers(false)
    this.log(`Tóm tắt ngắt: uptime=${uptime}ms, packets=${this.packetCount}, lastPacketAgo=${lastPacketAgo}ms.`, 'network')
    this.log(`Đã ngắt kết nối${reason ? `: ${reason}` : '.'}`, 'warn')
    if (this.manualStop || this.blockedByProtection) {
      this.status = this.blockedByProtection ? 'blocked' : 'offline'
      this.emitState()
      return
    }
    if (!wasOnline || uptime < 30_000) this.failedAttempts += 1
    else this.failedAttempts = 0
    this.scheduleReconnect(failure)
  }

  scheduleReconnect(value = '') {
    if (this.manualStop || this.blockedByProtection || !this.profile.autoReconnectEnabled) {
      this.status = 'offline'
      this.emitState()
      return
    }
    if (this.reconnectTimer) return
    const failure = connectionFailureInfo(value, {
      phase: this.status,
      hasAuthenticatedBefore: this.hasAuthenticatedBefore
    })
    if (!failure.retryable) {
      this.status = 'offline'
      this.lastError = failure.message
      this.log(`${failure.message} ZCore đã dừng tự kết nối lại; hãy kiểm tra đúng tài khoản rồi nhấn Bắt đầu.`, 'error')
      this.emitState()
      return
    }
    let seconds
    if (failure.kind === 'auth-service') {
      seconds = authReconnectDelay(this.authFailedAttempts)
      this.authFailedAttempts += 1
    } else {
      seconds = reconnectDelay(this.profile, Math.max(0, this.failedAttempts - 1))
    }
    const delayMs = seconds * 1000 + profileStaggerOffset(this.profile.id, RECONNECT_STAGGER_WINDOW_MS)
    this.status = 'reconnecting'
    this.emitState()
    this.log(failure.kind === 'auth-service'
      ? `Giữ nguyên phiên Microsoft; sẽ thử lại xác thực sau ${(delayMs / 1000).toFixed(1)} giây.`
      : `Sẽ kết nối lại sau ${(delayMs / 1000).toFixed(1)} giây (${failure.message})...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect(true)
    }, delayMs)
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  clearConnectionTimers() {
    if (this.connectionTimer) clearTimeout(this.connectionTimer)
    if (this.authTimer) clearTimeout(this.authTimer)
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.connectionTimer = this.authTimer = this.stableTimer = null
  }

  startRuntimeTimers() {
    this.stopRuntimeTimers(false)
    const stateInterval = this.resourceSavingMode ? HEADLESS_RUNTIME_STATE_INTERVAL_MS : RUNTIME_STATE_INTERVAL_MS
    this.runtimeTimer = setInterval(() => this.emitState(), stateInterval)
    this.runtimeTimer.unref?.()
    this.startProtectionTimer()
    this.startReportTimer()
    this.startNoSellWatch()
    this.startBalanceCommandTimer()
    this.startNetworkWatchdog()
  }

  startNetworkWatchdog() {
    if (this.networkWatchdogTimer) clearInterval(this.networkWatchdogTimer)
    this.networkWatchdogTimer = null
    if (this.status !== 'online') return
    this.networkWatchdogTimer = setInterval(() => this.checkNetworkHealth(), NETWORK_WATCHDOG_INTERVAL_MS)
    this.networkWatchdogTimer.unref?.()
  }

  checkNetworkHealth(now = Date.now()) {
    if (this.status !== 'online' || !this.bot || this.networkStallTriggered || !this.lastPacketAt) return false
    const timeoutMs = Math.max(30, Number(this.profile.networkStallTimeoutSeconds) || 75) * 1000
    const silentMs = Number(now) - this.lastPacketAt
    if (silentMs < timeoutMs) return false
    this.networkStallTriggered = true
    this.log(`Kết nối im lặng ${(silentMs / 1000).toFixed(0)} giây; chủ động nối lại để tránh bot đứng yên.`, 'warn')
    const client = this.bot._client
    try { client.end('ZCore network watchdog') } catch {}
    const socketTimer = setTimeout(() => {
      if (this.networkStallTriggered && this.status === 'online') {
        try { client.socket?.destroy() } catch {}
      }
    }, 2_000)
    socketTimer.unref?.()
    return true
  }

  startProtectionTimer() {
    if (this.protectionTimer) clearInterval(this.protectionTimer)
    this.protectionTimer = null
    if (
      this.status !== 'online' ||
      (
        !this.profile.coordinateProtectionEnabled &&
        !this.profile.whitelistGuardEnabled &&
        !this.profile.webhookStrangerAlertEnabled
      )
    ) return
    this.protectionTimer = setInterval(() => this.checkProtection(), PROTECTION_INTERVAL_MS)
    this.protectionTimer.unref?.()
  }

  markConfirmedSale(at = Date.now()) {
    const time = Number(at) || Date.now()
    if (!this.lastConfirmedSaleAt || time - this.lastConfirmedSaleAt > 1_000) {
      this.saleSequence += 1
      this.lastConfirmedSaleId = this.saleSequence
    }
    this.lastConfirmedSaleAt = Math.max(this.lastConfirmedSaleAt, time)
    this.lastNoSellAlertAt = 0
    this.startNoSellWatch()
  }

  startNoSellWatch() {
    if (this.noSellTimer) clearTimeout(this.noSellTimer)
    this.noSellTimer = null
    if (
      this.status !== 'online' ||
      !this.profile.autoSellEnabled ||
      !this.profile.discordWebhookEnabled ||
      !this.profile.discordWebhookUrl ||
      !this.profile.webhookNoSellAlertEnabled
    ) return
    const intervalMs = webhookNoSellMs(this.profile)
    const baseline = Math.max(this.lastConfirmedSaleAt, this.lastNoSellAlertAt, this.connectedAt) || Date.now()
    const remainingMs = Math.max(1, intervalMs - (Date.now() - baseline))
    this.noSellTimer = setTimeout(() => {
      this.noSellTimer = null
      if (
        this.status !== 'online' ||
        !this.profile.autoSellEnabled ||
        !this.profile.webhookNoSellAlertEnabled
      ) return
      this.sendAlertWebhook('no-sell', { minutes: this.profile.webhookNoSellMinutes })
      this.lastNoSellAlertAt = Date.now()
      this.startNoSellWatch()
    }, remainingMs)
    this.noSellTimer.unref?.()
  }

  canSendAutoHome(bot = this.bot, generation = this.generation) {
    if (!this.isCurrent(bot, generation) || this.status !== 'online' || bot.currentWindow) return false
    if (!this.controller) return true
    if (this.controller.busy || this.controller.paused) return false
    return !AUTO_HOME_BLOCKED_STATES.has(this.controller.state)
  }

  pauseAutoSellForHome() {
    const controller = this.controller
    if (!controller?.running || controller.paused) return { controller, shouldResume: false }
    controller.pause(AUTO_HOME_PAUSE_REASON)
    return { controller, shouldResume: true }
  }

  resumeAutoSellAfterHome({ sent, context } = {}) {
    if (!context?.shouldResume) return
    if (this.autoHomeResumeTimer) clearTimeout(this.autoHomeResumeTimer)
    const delayMs = sent ? AUTO_HOME_AUTOSELL_PAUSE_MS : 0
    this.autoHomeResumeTimer = setTimeout(() => {
      this.autoHomeResumeTimer = null
      const controller = context.controller
      if (
        controller !== this.controller ||
        !controller?.running ||
        this.status !== 'online' ||
        !this.profile.autoSellEnabled
      ) return
      controller.resume(AUTO_HOME_PAUSE_REASON)
    }, delayMs)
    this.autoHomeResumeTimer.unref?.()
  }

  requestBalance() {
    if (
      this.profile.balanceTrackingEnabled === false ||
      !this.profile.balanceCommandEnabled ||
      !this.bot ||
      this.status !== 'online'
    ) return false
    this.markBalanceRequest()
    try {
      this.bot.chat('/balance')
      return true
    } catch (error) {
      this.balanceResponseDeadlineAt = 0
      this.lastBalanceRequestError = error.message
      this.log(`Không gửi được /balance: ${error.message}`, 'warn', error)
      this.emitState()
      return false
    }
  }

  startBalanceCommandTimer() {
    if (this.balanceCommandTimer) clearInterval(this.balanceCommandTimer)
    if (this.balanceCommandInitialTimer) clearTimeout(this.balanceCommandInitialTimer)
    this.balanceCommandTimer = this.balanceCommandInitialTimer = null
    if (
      this.profile.balanceTrackingEnabled === false ||
      !this.profile.balanceCommandEnabled ||
      this.status !== 'online'
    ) return
    const initialDelayMs = BALANCE_COMMAND_INITIAL_DELAY_MS + profileStaggerOffset(
      this.profile.id,
      BALANCE_COMMAND_STAGGER_WINDOW_MS
    )
    this.balanceCommandInitialTimer = setTimeout(() => {
      this.balanceCommandInitialTimer = null
      this.requestBalance()
      this.balanceCommandTimer = setInterval(() => this.requestBalance(), BALANCE_COMMAND_INTERVAL_MS)
      this.balanceCommandTimer.unref?.()
    }, initialDelayMs)
    this.balanceCommandInitialTimer.unref?.()
  }

  startReportTimer() {
    if (this.reportTimer) clearInterval(this.reportTimer)
    if (this.reportInitialTimer) clearTimeout(this.reportInitialTimer)
    this.reportTimer = this.reportInitialTimer = null
    if (
      !this.profile.discordWebhookEnabled ||
      !this.profile.discordWebhookUrl ||
      !this.profile.statsEnabled ||
      !this.profile.webhookPeriodicReportEnabled
    ) return
    const intervalMs = webhookIntervalMs(this.profile)
    const initialDelayMs = intervalMs + profileStaggerOffset(this.profile.id, WEBHOOK_STAGGER_WINDOW_MS)
    this.reportInitialTimer = setTimeout(() => {
      this.reportInitialTimer = null
      this.sendStatsWebhook(false)
      this.reportTimer = setInterval(() => this.sendStatsWebhook(false), intervalMs)
      this.reportTimer.unref?.()
    }, initialDelayMs)
    this.reportInitialTimer.unref?.()
  }

  stopRuntimeTimers(stopStats) {
    if (this.runtimeTimer) clearInterval(this.runtimeTimer)
    if (this.protectionTimer) clearInterval(this.protectionTimer)
    if (this.reportTimer) clearInterval(this.reportTimer)
    if (this.reportInitialTimer) clearTimeout(this.reportInitialTimer)
    if (this.balanceCommandTimer) clearInterval(this.balanceCommandTimer)
    if (this.balanceCommandInitialTimer) clearTimeout(this.balanceCommandInitialTimer)
    if (this.networkWatchdogTimer) clearInterval(this.networkWatchdogTimer)
    if (this.autoHomeResumeTimer) clearTimeout(this.autoHomeResumeTimer)
    if (this.noSellTimer) clearTimeout(this.noSellTimer)
    this.runtimeTimer = this.protectionTimer = this.reportTimer = this.reportInitialTimer = null
    this.balanceCommandTimer = this.balanceCommandInitialTimer = null
    this.networkWatchdogTimer = null
    this.autoHomeResumeTimer = null
    this.noSellTimer = null
    if (stopStats) this.stats.stop()
  }

  async checkProtection() {
    const bot = this.bot
    if (!bot?.entity) return
    if (this.profile.coordinateProtectionEnabled && this.origin && this.controller?.running) {
      const distance = bot.entity.position.distanceTo(this.origin)
      const threshold = Math.max(0.1, Number(this.profile.positionThreshold) || 1)
      if (distance > threshold && !this.wasDisplaced) {
        this.wasDisplaced = true
        this.controller.pause(`Lệch vị trí ${distance.toFixed(1)} block`)
        this.log(`Auto Sell tạm dừng: lệch vị trí gốc ${distance.toFixed(1)} block.`, 'warn')
      } else if (distance <= threshold && this.wasDisplaced) {
        this.wasDisplaced = false
        this.controller.resume()
        this.log('Đã trở lại vị trí gốc, tiếp tục Auto Sell.', 'success')
      }
    }

    if (!this.profile.whitelistGuardEnabled && !this.profile.webhookStrangerAlertEnabled) return
    const radius = Math.max(1, Number(this.profile.whitelistScanRadius) || 32)
    const found = new Map()
    for (const player of Object.values(bot.players || {})) {
      if (!player?.entity || player.username === bot.username || this.whitelist.has(player.username.toLowerCase())) continue
      const distance = player.entity.position.distanceTo(bot.entity.position)
      if (distance > radius) continue
      found.set(player.username.toLowerCase(), { username: player.username, distance })
    }
    for (const [key, player] of found) {
      if (!this.nearbyStrangers.has(key)) await this.handleStranger(player.username, player.distance)
    }
    this.nearbyStrangers = new Set(found.keys())
    if (!found.size && this.controller?.paused) {
      if (this.controller.resume(STRANGER_PAUSE_REASON)) {
        this.log('Người lạ đã rời khỏi bán kính; tiếp tục Auto Sell.', 'success')
      }
    }
  }

  async handleStranger(username, distance) {
    const requestedAction = this.profile.whitelistGuardEnabled ? this.profile.strangerAction : 'notify'
    const action = ['notify', 'pause', 'disconnect'].includes(requestedAction) ? requestedAction : 'notify'
    const position = this.bot?.entity?.position
    this.log(
      `Phát hiện ${username} ở khoảng cách ${distance.toFixed(1)} block — ${strangerActionLabel(action)}.`,
      action === 'notify' ? 'warn' : 'error'
    )
    if (this.profile.webhookStrangerAlertEnabled) {
      this.sendAlertWebhook('stranger', {
        player: username,
        distance,
        action: strangerActionLabel(action),
        position: position
          ? `X ${position.x.toFixed(1)}, Y ${position.y.toFixed(1)}, Z ${position.z.toFixed(1)}`
          : ''
      })
    }
    if (action === 'pause') {
      this.controller?.pause(STRANGER_PAUSE_REASON)
      return
    }
    if (action !== 'disconnect' || this.blockedByProtection) return
    this.blockedByProtection = true
    this.controller?.stop()
    this.axeController?.stop()
    this.homeController?.stop()
    try { this.bot?.quit(`ZCore: Phát hiện người chơi ${username}`) } catch {}
  }

  sendAlertWebhook(type, details = {}, username = this.bot?.username || this.lastKnownUsername) {
    if (!this.profile.discordWebhookEnabled || !this.profile.discordWebhookUrl) return Promise.resolve(false)
    const url = this.profile.discordWebhookUrl
    const payload = alertPayload(this.profile, username, type, details)
    const task = async () => {
      try {
        await postWebhook(url, payload)
        this.log(`Đã gửi cảnh báo Discord: ${type}.`, 'success')
        return true
      } catch (error) {
        this.log(`Discord Webhook: ${error.message}`, 'error', error)
        return false
      }
    }
    this.webhookQueue = this.webhookQueue.then(task, task)
    return this.webhookQueue
  }

  async sendStatsWebhook(isFinal) {
    if (
      !this.profile.discordWebhookEnabled ||
      !this.profile.discordWebhookUrl ||
      !this.profile.statsEnabled ||
      !this.profile.webhookPeriodicReportEnabled
    ) return
    if (isFinal && this.stats.totalEarned <= 0) return
    if (this.webhookInFlight) return
    this.webhookInFlight = true
    try {
      await postWebhook(this.profile.discordWebhookUrl, statsPayload(this.profile, this.bot?.username, this.stats.snapshot(), isFinal))
      this.log('Đã gửi báo cáo Discord.', 'success')
    } catch (error) {
      this.log(`Discord Webhook: ${error.message}`, 'error', error)
    } finally {
      this.webhookInFlight = false
    }
  }

  stop() {
    this.manualStop = true
    this.generation += 1
    this.clearReconnectTimer()
    this.clearConnectionTimers()
    this.clientTickSync?.stop()
    this.clientTickSync = null
    this.controller?.stop()
    this.axeController?.stop()
    this.homeController?.stop()
    this.homeController = null
    this.sendStatsWebhook(true)
    this.stopRuntimeTimers(true)
    const bot = this.bot
    this.bot = null
    this.balanceTracker.detach()
    this.clearBalanceRequest()
    if (bot) {
      try { bot.quit('ZCore stopped') } catch { try { bot.end() } catch {} }
    }
    this.status = 'offline'
    this.log('Đã dừng profile.')
    this.emitState()
  }

  resetStats() {
    this.stats.reset()
    this.log('Đã đặt lại thống kê phiên.')
  }

  sendChat(text) {
    if (!this.bot || this.status !== 'online') throw new Error('Bot chưa online')
    const value = normalizeChatInput(text)
    const balanceCommand = this.profile.balanceTrackingEnabled !== false && isBalanceCommand(value)
    if (balanceCommand) this.markBalanceRequest()
    try {
      this.bot.chat(value)
    } catch (error) {
      if (balanceCommand) {
        this.balanceResponseDeadlineAt = 0
        this.lastBalanceRequestError = error.message
        this.emitState()
      }
      throw error
    }
    this.log(`> ${value}`, 'command')
  }

  setResourceSavingMode(enabled, writeLog = true) {
    this.resourceSavingMode = enabled === true
    if (writeLog) this.log(this.resourceSavingMode
      ? 'Đã bật treo nền siêu nhẹ: tạm ngừng log chat/actionbar và state Auto Sell không thiết yếu.'
      : 'Đã mở lại giao diện: tiếp tục log và state thời gian thực.')
    if (this.status === 'online') {
      if (this.runtimeTimer) clearInterval(this.runtimeTimer)
      const stateInterval = this.resourceSavingMode ? HEADLESS_RUNTIME_STATE_INTERVAL_MS : RUNTIME_STATE_INTERVAL_MS
      this.runtimeTimer = setInterval(() => this.emitState(), stateInterval)
      this.runtimeTimer.unref?.()
    }
    this.emitState()
  }

  applyProfile(profile) {
    const autoSellWasEnabled = this.profile.autoSellEnabled
    const autoSellAxeWasEnabled = this.profile.autoSellAxeEnabled
    const previousAutoHomeSignature = [
      this.profile.autoHomeEnabled,
      this.profile.autoHomeNumber,
      this.profile.autoHomeDelayMinutes
    ].join('|')
    const balanceTrackingWasEnabled = this.profile.balanceTrackingEnabled
    const balanceCommandWasEnabled = this.profile.balanceCommandEnabled
    const protectionWasEnabled = (
      this.profile.coordinateProtectionEnabled ||
      this.profile.whitelistGuardEnabled ||
      this.profile.webhookStrangerAlertEnabled
    )
    const playerTrackingWasEnabled = playerTrackingEnabled(this.profile)
    const previousWebhookInterval = webhookIntervalMs(this.profile)
    const previousWebhookSignature = [
      this.profile.discordWebhookEnabled,
      this.profile.discordWebhookUrl,
      this.profile.statsEnabled,
      this.profile.webhookPeriodicReportEnabled
    ].join('|')
    const previousNoSellSignature = [
      this.profile.discordWebhookEnabled,
      this.profile.discordWebhookUrl,
      this.profile.autoSellEnabled,
      this.profile.webhookNoSellAlertEnabled,
      this.profile.webhookNoSellMinutes
    ].join('|')
    this.profile = profile
    this.whitelist = new Set((profile.whitelistedPlayers || []).map((value) => String(value).toLowerCase()))
    if (this.controller) {
      this.controller.setDelaySettings(profile)
      if (!autoSellWasEnabled && profile.autoSellEnabled) this.controller.start()
      if (autoSellWasEnabled && !profile.autoSellEnabled) this.controller.stop()
    }
    if (this.axeController) {
      this.axeController.setSettings(profile)
      if (!autoSellAxeWasEnabled && profile.autoSellAxeEnabled) this.axeController.start()
      if (autoSellAxeWasEnabled && !profile.autoSellAxeEnabled) this.axeController.stop()
    }
    if (this.homeController) {
      this.homeController.setSettings(profile)
      if (profile.autoHomeEnabled && !this.homeController.running) this.homeController.start()
      const autoHomeSignature = [
        profile.autoHomeEnabled,
        profile.autoHomeNumber,
        profile.autoHomeDelayMinutes
      ].join('|')
      if (previousAutoHomeSignature !== autoHomeSignature) {
        this.log(profile.autoHomeEnabled
          ? `Đã bật Auto Home: /home ${profile.autoHomeNumber} mỗi ${profile.autoHomeDelayMinutes} phút.`
          : 'Đã tắt Auto Home.')
      }
    }
    const webhookSignature = [
      profile.discordWebhookEnabled,
      profile.discordWebhookUrl,
      profile.statsEnabled,
      profile.webhookPeriodicReportEnabled
    ].join('|')
    if (this.status === 'online' && (
      previousWebhookInterval !== webhookIntervalMs(profile) || previousWebhookSignature !== webhookSignature
    )) {
      this.startReportTimer()
      if (previousWebhookInterval !== webhookIntervalMs(profile)) {
        this.log(`Đã đổi chu kỳ gửi Webhook thành ${profile.discordWebhookIntervalMinutes} phút.`)
      }
    }
    const noSellSignature = [
      profile.discordWebhookEnabled,
      profile.discordWebhookUrl,
      profile.autoSellEnabled,
      profile.webhookNoSellAlertEnabled,
      profile.webhookNoSellMinutes
    ].join('|')
    if (this.status === 'online' && previousNoSellSignature !== noSellSignature) this.startNoSellWatch()
    if (this.status === 'online' && (
      balanceTrackingWasEnabled !== profile.balanceTrackingEnabled ||
      balanceCommandWasEnabled !== profile.balanceCommandEnabled
    )) {
      const balanceTrackingEnabled = profile.balanceTrackingEnabled !== false
      this.bot?._client?.configureUltraLite?.({
        scoreboardEnabled: balanceTrackingEnabled && profile.balanceCommandEnabled === false
      })
      this.balanceTracker.setScoreboardPolling(balanceTrackingEnabled && profile.balanceCommandEnabled === false)
      if (!balanceTrackingEnabled || !profile.balanceCommandEnabled) this.clearBalanceRequest()
      if (!balanceTrackingEnabled) this.balanceTracker.reset()
      this.startBalanceCommandTimer()
      this.log(!balanceTrackingEnabled
        ? 'Đã tắt hoàn toàn theo dõi số dư để giảm xử lý nền.'
        : (profile.balanceCommandEnabled
            ? 'Đã bật tự cập nhật số dư bằng /balance mỗi 30 giây.'
            : 'Đã chuyển theo dõi số dư sang scoreboard/chat.'))
    }
    const protectionEnabled = (
      profile.coordinateProtectionEnabled ||
      profile.whitelistGuardEnabled ||
      profile.webhookStrangerAlertEnabled
    )
    if (this.status === 'online' && protectionWasEnabled !== protectionEnabled) this.startProtectionTimer()
    if (this.status === 'online' && playerTrackingWasEnabled !== playerTrackingEnabled(profile)) {
      this.bot?._client?.configureUltraLite?.({ playerTrackingEnabled: playerTrackingEnabled(profile) })
      this.log(playerTrackingEnabled(profile)
        ? 'Đã bật decode packet người chơi để phục vụ Whitelist Guard / cảnh báo người lạ.'
        : 'Đã bỏ decode packet người chơi để giảm CPU.', 'network')
    }
    this.emitState()
  }
}

module.exports = {
  BotSession,
  reconnectDelay,
  authReconnectDelay,
  errorText,
  connectionFailureInfo,
  failureLogMessage,
  normalizeChatInput,
  isBalanceCommand,
  webhookIntervalMs,
  webhookNoSellMs,
  strangerActionLabel,
  afkRuntimeOptions,
  createBotForProfile,
  playerTrackingEnabled,
  profileStaggerOffset,
  LOG_CACHE_LIMIT,
  RUNTIME_STATE_INTERVAL_MS,
  HEADLESS_RUNTIME_STATE_INTERVAL_MS,
  PROTECTION_INTERVAL_MS,
  ACTIONBAR_LOG_INTERVAL_MS,
  BALANCE_COMMAND_INTERVAL_MS,
  BALANCE_COMMAND_INITIAL_DELAY_MS,
  BALANCE_COMMAND_STAGGER_WINDOW_MS,
  BALANCE_COMMAND_RESPONSE_TIMEOUT_MS,
  RECONNECT_STAGGER_WINDOW_MS,
  WEBHOOK_STAGGER_WINDOW_MS,
  NETWORK_WATCHDOG_INTERVAL_MS,
  AUTH_RECONNECT_BASE_SECONDS,
  AUTH_RECONNECT_MAX_SECONDS,
  AUTO_HOME_AUTOSELL_PAUSE_MS,
  AUTO_HOME_PAUSE_REASON,
  STRANGER_PAUSE_REASON,
  DEATH_ALERT_COOLDOWN_MS,
  AUTO_HOME_BLOCKED_STATES
}
