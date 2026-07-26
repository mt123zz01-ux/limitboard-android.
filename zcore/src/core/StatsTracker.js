const { parseNumber } = require('./BalanceTracker')

const MONEY_PATTERN = /\$[ \t]*([0-9]+(?:[.,][0-9]+)*(?:[ \t]+[0-9]+)*)(?:[ \t]*([KMBT]))?/i
const SELL_CONFIRMATION_PATTERN = /(?:\b(?:you\s+)?sold\b|\bsale\s+(?:complete|completed|successful|success)\b|\bsell(?:ing)?\s+(?:complete|completed|successful|success|th[aà]nh\s+c[oô]ng)\b|đ[aã]\s+b[aá]n|b[aá]n\s+th[aà]nh\s+c[oô]ng)/i
const NON_SELL_MONEY_PATTERN = /(?:\bbal(?:ance)?\b|\bmoney\b|\bcash\b|\bwallet\b|\bpay(?:ment|ed|ing)?\b|\bpaid\b|\bsent\b|\bsend\b|\breceiv(?:e|ed|ing)\b|\btransfer(?:red|ring)?\b|\bgave\b|s[oố]\s*d[uư]|b[aạ]n\s+c[oó]|chuy[eể]n\s+ti[eề]n|nh[aậ]n\s+ti[eề]n|tr[aả]\s+ti[eề]n)/i
const PURE_GAIN_PATTERN = /^\s*\+?\s*\$\s*[0-9]+(?:[.,][0-9]+)*(?:\s*[KMBT])?\s*[.!]?\s*$/i
const SALE_CONTEXT_MAX_AGE_MS = 12_000

class StatsTracker {
  constructor(onChange = () => {}) {
    this.onChange = onChange
    this.totalEarned = 0
    this.totalSalesCount = 0
    this.startedAt = Date.now()
    this.stoppedAt = null
    this.lastCountedSaleId = null
    this.lastSignature = null
    this.lastSignatureAt = 0
  }

  reset() {
    this.totalEarned = 0
    this.totalSalesCount = 0
    this.startedAt = Date.now()
    this.stoppedAt = null
    this.lastCountedSaleId = null
    this.lastSignature = null
    this.lastSignatureAt = 0
    this.onChange(this.snapshot())
  }

  stop() {
    if (!this.stoppedAt) this.stoppedAt = Date.now()
    this.onChange(this.snapshot())
  }

  parseMessage(text, isOverlay = false, context = {}) {
    if (typeof text !== 'string' || !text.trim()) return null
    const clean = text.replace(/§[0-9A-FK-ORX]/gi, '').trim()
    if (clean.includes('<') && clean.includes('>')) return null

    const saleAgeMs = Number(context.saleAgeMs)
    const saleContext = context.saleContext === true || (
      Number.isFinite(saleAgeMs) && saleAgeMs >= 0 && saleAgeMs <= SALE_CONTEXT_MAX_AGE_MS
    )
    if (!saleContext) return null

    const explicitSell = SELL_CONFIRMATION_PATTERN.test(clean)
    if (NON_SELL_MONEY_PATTERN.test(clean) && !explicitSell) return null
    if (!explicitSell && !PURE_GAIN_PATTERN.test(clean)) return null

    const match = MONEY_PATTERN.exec(clean)
    if (!match) return null
    const amount = parseNumber(match[1], match[2])
    if (amount === null) return null

    const saleId = context.saleId ?? null
    if (saleId !== null && saleId === this.lastCountedSaleId) return null
    const signature = `${clean.toLocaleLowerCase('vi')}|${amount}`
    const now = Date.now()
    if (signature === this.lastSignature && now - this.lastSignatureAt < 5_000) return null

    this.lastCountedSaleId = saleId
    this.lastSignature = signature
    this.lastSignatureAt = now
    this.totalEarned += amount
    this.totalSalesCount += 1
    this.onChange(this.snapshot())
    return amount
  }

  elapsedMs() {
    return Math.max(0, (this.stoppedAt || Date.now()) - this.startedAt)
  }

  earnedPerHour() {
    const elapsed = this.elapsedMs()
    return elapsed > 0 ? this.totalEarned / (elapsed / 3_600_000) : 0
  }

  snapshot() {
    return {
      totalEarned: this.totalEarned,
      totalSalesCount: this.totalSalesCount,
      elapsedMs: this.elapsedMs(),
      earnedPerHour: this.earnedPerHour(),
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt
    }
  }

  static formatCurrency(amount) {
    if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`
    return `$${Math.round(amount)}`
  }
}

module.exports = {
  StatsTracker,
  MONEY_PATTERN,
  SELL_CONFIRMATION_PATTERN,
  NON_SELL_MONEY_PATTERN,
  PURE_GAIN_PATTERN,
  SALE_CONTEXT_MAX_AGE_MS
}
