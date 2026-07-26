const BALANCE_LABEL = /(?:\bbal(?:ance)?\b|\bmoney\b|\bcash\b|\bwallet\b|\bcoins?\b|s[oố]\s*d[uư]|ti[eề]n)/i
const ACCOUNT_BALANCE_LABEL = /(?:\byou\s+have\b|b[aạ]n\s+(?:đang\s+)?c[oó]\b)/i
const CURRENCY_VALUE = /(?:[$₫đ]\s*)?([0-9]+(?:[.,][0-9]+)*(?:\s+[0-9]+)*)(?:\s*([KMBT]))?/i
const EXPLICIT_CURRENCY_VALUE = /[$₫đ]\s*([0-9]+(?:[.,][0-9]+)*(?:\s+[0-9]+)*)(?:\s*([KMBT]))?/i
const SUFFIX_CURRENCY_VALUE = /([0-9]+(?:[.,][0-9]+)*)\s*([KMBT])\b/i
const BALANCE_COMMAND_REJECT_PATTERN = /(?:^\s*<[^>]+>|\b(?:pay(?:ment|ed|ing)?|paid|sent|send|receiv(?:e|ed|ing)|transfer(?:red|ring)?|sold|sale|sell(?:ing)?)\b|chuy[eể]n\s+ti[eề]n|nh[aậ]n\s+ti[eề]n|đ[aã]\s+b[aá]n)/i
const BALANCE_COMMAND_SELF_PATTERN = /^(?:you\s+have|b[aạ]n\s+(?:đang\s+)?c[oó])\s*[:=>\-]?\s*[$₫đ]\s*([0-9]+(?:[.,][0-9]+)*(?:\s+[0-9]+)*)(?:\s*([KMBT]))?\s*[.!]?\s*$/i
const BALANCE_COMMAND_LABEL_PATTERN = /^(?:(?:your\s+)?(?:bal(?:ance)?|money|cash|wallet|coins?)(?:\s+is)?|(?:s[oố]\s*d[uư]|ti[eề]n)(?:\s+c[uủ]a\s+b[aạ]n)?)\s*[:=>\-]?\s*(?:[$₫đ]\s*)?([0-9]+(?:[.,][0-9]+)*(?:\s+[0-9]+)*)(?:\s*([KMBT]))?(?:\s*[$₫đ])?\s*[.!]?\s*$/i
const BALANCE_POLL_INTERVAL_MS = 5_000
const MAX_SCORE_ENTRIES = 512
const MAX_OBJECTIVES = 32

function flattenStrings(value, output = [], seen = new Set()) {
  if (value === null || value === undefined) return output
  if (typeof value === 'string') {
    output.push(value)
    return output
  }
  if (typeof value !== 'object' || Buffer.isBuffer(value) || seen.has(value)) return output
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, output, seen)
  } else {
    for (const item of Object.values(value)) flattenStrings(item, output, seen)
  }
  return output
}

function plainText(value) {
  if (value === null || value === undefined) return ''
  let text = ''
  if (typeof value === 'string') text = value
  else {
    try { text = value.toString() } catch { text = '' }
    if (!text || text === '[object Object]') text = flattenStrings(value).join(' ')
  }
  return text.replace(/§[0-9A-FK-ORX]/gi, '').replace(/\s+/g, ' ').trim()
}

function parseNumber(raw, suffix = '') {
  let value = String(raw || '').replace(/\s+/g, '')
  if (!value) return null

  const lastComma = value.lastIndexOf(',')
  const lastDot = value.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = Math.max(lastComma, lastDot)
    value = value.slice(0, decimal).replace(/[.,]/g, '') + '.' + value.slice(decimal + 1).replace(/[.,]/g, '')
  } else {
    const separator = lastComma >= 0 ? ',' : (lastDot >= 0 ? '.' : '')
    if (separator) {
      const parts = value.split(separator)
      const finalDigits = parts.at(-1).length
      const isDecimal = parts.length === 2 && (suffix || finalDigits <= 2)
      value = isDecimal ? `${parts[0]}.${parts[1]}` : parts.join('')
    }
  }

  let amount = Number.parseFloat(value)
  const multiplier = ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 })[String(suffix).toUpperCase()] || 1
  amount *= multiplier
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function parseCurrencyText(input) {
  const text = plainText(input)
  const match = EXPLICIT_CURRENCY_VALUE.exec(text) || SUFFIX_CURRENCY_VALUE.exec(text)
  return match ? parseNumber(match[1], match[2]) : null
}

function parseBalanceText(input) {
  const text = plainText(input)
  if (!text || BALANCE_COMMAND_REJECT_PATTERN.test(text)) return null
  const label = BALANCE_LABEL.exec(text)
  const accountLabel = label ? null : ACCOUNT_BALANCE_LABEL.exec(text)
  if (!label && !accountLabel) return null
  if (accountLabel) return parseBalanceCommandResponse(text)
  const activeLabel = label || accountLabel
  const tail = text.slice(activeLabel.index + activeLabel[0].length).replace(/^[\s:=>\-]+/, '')
  const match = CURRENCY_VALUE.exec(tail)
  return match ? parseNumber(match[1], match[2]) : null
}

function parseBalanceCommandResponse(input) {
  const text = plainText(input)
  if (!text || BALANCE_COMMAND_REJECT_PATTERN.test(text)) return null
  const match = BALANCE_COMMAND_SELF_PATTERN.exec(text) || BALANCE_COMMAND_LABEL_PATTERN.exec(text)
  return match ? parseNumber(match[1], match[2]) : null
}

function scoreKey(objective, player) {
  return `${String(objective || '')}\u0000${String(player || '').toLocaleLowerCase('en-US')}`
}

class BalanceTracker {
  constructor(onChange = () => {}) {
    this.onChange = onChange
    this.amount = null
    this.source = null
    this.updatedAt = null
    this.bot = null
    this.scoreboardPollingEnabled = false
    this.pollTimer = null
    this.initialScanTimer = null
    this.clientListeners = []
    this.displayObjectives = new Map()
    this.objectives = new Map()
    this.scorePackets = new Map()
  }

  reset() {
    this.amount = null
    this.source = null
    this.updatedAt = null
    this.onChange(this.snapshot())
  }

  update(amount, source) {
    if (!Number.isFinite(amount) || amount < 0) return false
    const changed = this.amount !== amount || this.source !== source
    this.amount = amount
    this.source = source
    this.updatedAt = Date.now()
    if (changed) this.onChange(this.snapshot())
    return true
  }

  observeText(text, source = 'chat') {
    const amount = parseBalanceText(text)
    return amount === null ? null : (this.update(amount, source), amount)
  }

  observeCommandResponse(text, source = 'balance-command') {
    const amount = parseBalanceCommandResponse(text)
    return amount === null ? null : (this.update(amount, source), amount)
  }

  attach(bot, { pollScoreboard = true } = {}) {
    this.detach()
    this.bot = bot
    this.setScoreboardPolling(pollScoreboard)
  }

  attachScoreboardListeners() {
    if (this.clientListeners.length || !this.bot?._client?.on) return
    this.listenClient('scoreboard_objective', (packet) => {
      if (packet.action === 1) this.objectives.delete(packet.name)
      else {
        this.objectives.set(packet.name, packet)
        while (this.objectives.size > MAX_OBJECTIVES) this.objectives.delete(this.objectives.keys().next().value)
      }
    })
    this.listenClient('scoreboard_display_objective', (packet) => {
      this.displayObjectives.set(Number(packet.position), packet.name)
    })
    this.listenClient('scoreboard_score', (packet) => {
      this.scorePackets.set(scoreKey(packet.scoreName, packet.itemName), packet)
      while (this.scorePackets.size > MAX_SCORE_ENTRIES) this.scorePackets.delete(this.scorePackets.keys().next().value)
    })
    this.listenClient('reset_score', (packet) => {
      const player = String(packet.entity_name || '').toLocaleLowerCase('en-US')
      if (packet.objective_name) this.scorePackets.delete(scoreKey(packet.objective_name, player))
      else {
        for (const key of this.scorePackets.keys()) {
          if (key.endsWith(`\u0000${player}`)) this.scorePackets.delete(key)
        }
      }
    })
  }

  detachScoreboardListeners() {
    for (const [event, listener] of this.clientListeners) this.bot?._client?.removeListener?.(event, listener)
    this.clientListeners = []
    this.displayObjectives.clear()
    this.objectives.clear()
    this.scorePackets.clear()
  }

  setScoreboardPolling(enabled) {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.initialScanTimer) clearTimeout(this.initialScanTimer)
    this.pollTimer = this.initialScanTimer = null
    this.scoreboardPollingEnabled = enabled === true
    if (!this.scoreboardPollingEnabled || !this.bot) {
      this.detachScoreboardListeners()
      return
    }
    this.attachScoreboardListeners()
    this.initialScanTimer = setTimeout(() => this.scanAll(), 250)
    this.initialScanTimer.unref?.()
    this.pollTimer = setInterval(() => this.scanAll(), BALANCE_POLL_INTERVAL_MS)
    this.pollTimer.unref?.()
  }

  listenClient(event, listener) {
    this.bot?._client?.on(event, listener)
    this.clientListeners.push([event, listener])
  }

  packetAmount(packet, objective) {
    for (const component of [packet?.display_name, packet?.styling, objective?.styling, objective?.displayText]) {
      const amount = parseCurrencyText(component)
      if (amount !== null) return amount
    }
    return Number.isFinite(Number(packet?.value)) && Number(packet.value) >= 0 ? Number(packet.value) : null
  }

  scanBelowName() {
    const username = this.bot?.username
    if (!username) return null
    const belowName = this.bot?.scoreboard?.belowName
    const objectiveName = this.displayObjectives.get(2) || belowName?.name
    if (objectiveName) {
      const packet = this.scorePackets.get(scoreKey(objectiveName, username))
      const packetValue = this.packetAmount(packet, this.objectives.get(objectiveName))
      if (packetValue !== null) {
        this.update(packetValue, 'below-name')
        return packetValue
      }
    }

    const item = (belowName?.items || []).find((entry) => String(entry.name || '').toLocaleLowerCase('en-US') === username.toLocaleLowerCase('en-US'))
    if (!item) return null
    const styledValue = parseCurrencyText(item.displayName)
    const amount = styledValue ?? (Number.isFinite(Number(item.value)) ? Number(item.value) : null)
    if (amount !== null && amount >= 0) {
      this.update(amount, 'below-name')
      return amount
    }
    return null
  }

  scanSidebar() {
    const scoreboard = this.bot?.scoreboard?.sidebar
    if (!scoreboard) return null
    const rows = [scoreboard.title, ...(scoreboard.items || []).map((item) => item.displayName || item.name)]
    for (const row of rows) {
      const amount = parseBalanceText(row)
      if (amount !== null) {
        this.update(amount, 'scoreboard')
        return amount
      }
    }
    return null
  }

  scanAll() {
    return this.scanBelowName() ?? this.scanSidebar()
  }

  detach() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.initialScanTimer) clearTimeout(this.initialScanTimer)
    this.pollTimer = this.initialScanTimer = null
    this.detachScoreboardListeners()
    this.scoreboardPollingEnabled = false
    this.bot = null
  }

  snapshot() {
    return {
      amount: this.amount,
      source: this.source,
      updatedAt: this.updatedAt,
      pollIntervalMs: this.scoreboardPollingEnabled ? BALANCE_POLL_INTERVAL_MS : null,
      scoreboardPollingEnabled: this.scoreboardPollingEnabled
    }
  }
}

module.exports = {
  BalanceTracker,
  parseBalanceText,
  parseBalanceCommandResponse,
  parseCurrencyText,
  parseNumber,
  plainText,
  flattenStrings,
  BALANCE_COMMAND_REJECT_PATTERN,
  BALANCE_COMMAND_SELF_PATTERN,
  BALANCE_COMMAND_LABEL_PATTERN,
  scoreKey,
  BALANCE_LABEL,
  ACCOUNT_BALANCE_LABEL,
  CURRENCY_VALUE,
  BALANCE_POLL_INTERVAL_MS,
  MAX_SCORE_ENTRIES,
  MAX_OBJECTIVES
}
