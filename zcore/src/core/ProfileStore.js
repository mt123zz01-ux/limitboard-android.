const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const DEFAULT_PROFILE = Object.freeze({
  name: 'Profile mới',
  microsoftAccount: '',
  host: '',
  port: 25565,
  version: '1.21.11',
  clientEngine: 'protocol',
  workerEnabled: true,
  afkLiteEnabled: true,
  autoSellEnabled: true,
  autoSellAxeEnabled: false,
  autoSellAxeLookUpEnabled: true,
  autoSellDelaySeconds: 0.2,
  autoSellRandomDelayEnabled: true,
  autoSellDelayMinSeconds: 0.15,
  autoSellDelayMaxSeconds: 0.3,
  autoSellInventoryCheckDelayMinSeconds: 0.1,
  autoSellInventoryCheckDelayMaxSeconds: 0.2,
  autoSellQuickAllDelayMinSeconds: 0.05,
  autoSellQuickAllDelayMaxSeconds: 0.1,
  autoSellMoveDelayMinSeconds: 0.25,
  autoSellMoveDelayMaxSeconds: 0.4,
  autoSellGuiTimeoutSeconds: 3,
  autoSellErrorCooldownSeconds: 1,
  autoSellTickMilliseconds: 50,
  autoHomeEnabled: false,
  autoHomeNumber: 1,
  autoHomeDelayMinutes: 5,
  consoleEnabled: true,
  statsEnabled: true,
  balanceTrackingEnabled: true,
  balanceCommandEnabled: true,
  autoReconnectEnabled: true,
  reconnectDelaySeconds: 10,
  reconnectMaxDelaySeconds: 60,
  connectionTimeoutSeconds: 45,
  networkStallTimeoutSeconds: 75,
  tcpKeepAliveDelaySeconds: 30,
  proxyEnabled: false,
  proxyType: 'SOCKS5',
  proxyHost: '',
  proxyPort: 1080,
  proxyUsername: '',
  proxyPassword: '',
  discordWebhookEnabled: false,
  discordWebhookUrl: '',
  discordMentionUserId: '',
  webhookPeriodicReportEnabled: true,
  webhookDeathAlertEnabled: false,
  webhookStrangerAlertEnabled: false,
  webhookNoSellAlertEnabled: false,
  webhookNoSellMinutes: 5,
  webhookOfflineAlertEnabled: false,
  discordWebhookIntervalMinutes: 60,
  coordinateProtectionEnabled: false,
  positionThreshold: 1,
  whitelistGuardEnabled: false,
  whitelistScanRadius: 32,
  strangerAction: 'notify',
  whitelistedPlayers: [],
  lastStats: {
    totalEarned: 0,
    totalSalesCount: 0,
    elapsedMs: 0,
    startedAt: null,
    stoppedAt: null
  }
})

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function numberInRange(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function mergeProfile(input = {}) {
  const base = deepClone(DEFAULT_PROFILE)
  const { sellSettings: _removedAutoSellSettings, ...profileInput } = input
  let autoSellDelayMinSeconds = numberInRange(input.autoSellDelayMinSeconds, 0.15, 0.05, 60)
  let autoSellDelayMaxSeconds = numberInRange(input.autoSellDelayMaxSeconds, 0.3, 0.05, 60)
  let autoSellInventoryCheckDelayMinSeconds = numberInRange(
    input.autoSellInventoryCheckDelayMinSeconds,
    0.1,
    0.05,
    60
  )
  let autoSellInventoryCheckDelayMaxSeconds = numberInRange(
    input.autoSellInventoryCheckDelayMaxSeconds,
    0.2,
    0.05,
    60
  )
  let autoSellQuickAllDelayMinSeconds = numberInRange(
    input.autoSellQuickAllDelayMinSeconds,
    0.05,
    0.05,
    60
  )
  let autoSellQuickAllDelayMaxSeconds = numberInRange(
    input.autoSellQuickAllDelayMaxSeconds,
    0.1,
    0.05,
    60
  )
  let autoSellMoveDelayMinSeconds = numberInRange(
    input.autoSellMoveDelayMinSeconds,
    0.25,
    0.05,
    60
  )
  let autoSellMoveDelayMaxSeconds = numberInRange(
    input.autoSellMoveDelayMaxSeconds,
    0.4,
    0.05,
    60
  )
  if (autoSellDelayMinSeconds > autoSellDelayMaxSeconds) {
    [autoSellDelayMinSeconds, autoSellDelayMaxSeconds] = [autoSellDelayMaxSeconds, autoSellDelayMinSeconds]
  }
  if (autoSellInventoryCheckDelayMinSeconds > autoSellInventoryCheckDelayMaxSeconds) {
    [autoSellInventoryCheckDelayMinSeconds, autoSellInventoryCheckDelayMaxSeconds] = [
      autoSellInventoryCheckDelayMaxSeconds,
      autoSellInventoryCheckDelayMinSeconds
    ]
  }
  if (autoSellQuickAllDelayMinSeconds > autoSellQuickAllDelayMaxSeconds) {
    [autoSellQuickAllDelayMinSeconds, autoSellQuickAllDelayMaxSeconds] = [
      autoSellQuickAllDelayMaxSeconds,
      autoSellQuickAllDelayMinSeconds
    ]
  }
  if (autoSellMoveDelayMinSeconds > autoSellMoveDelayMaxSeconds) {
    [autoSellMoveDelayMinSeconds, autoSellMoveDelayMaxSeconds] = [
      autoSellMoveDelayMaxSeconds,
      autoSellMoveDelayMinSeconds
    ]
  }
  return {
    ...base,
    ...profileInput,
    id: input.id || crypto.randomUUID(),
    name: String(input.name || base.name).trim().slice(0, 48),
    microsoftAccount: String(input.microsoftAccount || '').trim().slice(0, 160),
    host: String(input.host || '').trim().slice(0, 255),
    port: Math.min(65535, Math.max(1, Number(input.port) || 25565)),
    clientEngine: input.clientEngine === 'mineflayer' ? 'mineflayer' : 'protocol',
    workerEnabled: input.workerEnabled !== false,
    afkLiteEnabled: input.afkLiteEnabled !== false,
    autoSellEnabled: input.autoSellAxeEnabled === true ? false : input.autoSellEnabled !== false,
    autoSellAxeEnabled: input.autoSellAxeEnabled === true,
    autoSellAxeLookUpEnabled: input.autoSellAxeLookUpEnabled !== false,
    autoSellDelaySeconds: numberInRange(input.autoSellDelaySeconds, 0.2, 0.05, 60),
    autoSellRandomDelayEnabled: input.autoSellRandomDelayEnabled !== false,
    autoSellDelayMinSeconds,
    autoSellDelayMaxSeconds,
    autoSellInventoryCheckDelayMinSeconds,
    autoSellInventoryCheckDelayMaxSeconds,
    autoSellQuickAllDelayMinSeconds,
    autoSellQuickAllDelayMaxSeconds,
    autoSellMoveDelayMinSeconds,
    autoSellMoveDelayMaxSeconds,
    autoSellGuiTimeoutSeconds: numberInRange(input.autoSellGuiTimeoutSeconds, 3, 0.05, 60),
    autoSellErrorCooldownSeconds: numberInRange(input.autoSellErrorCooldownSeconds, 1, 0.05, 60),
    autoSellTickMilliseconds: Math.round(numberInRange(input.autoSellTickMilliseconds, 50, 20, 1_000)),
    autoHomeEnabled: input.autoHomeEnabled === true,
    autoHomeNumber: Math.round(numberInRange(input.autoHomeNumber, 1, 1, 4)),
    autoHomeDelayMinutes: numberInRange(input.autoHomeDelayMinutes, 5, 1, 1440),
    balanceTrackingEnabled: input.balanceTrackingEnabled !== false,
    balanceCommandEnabled: input.balanceCommandEnabled !== false,
    reconnectDelaySeconds: Math.min(300, Math.max(1, Number(input.reconnectDelaySeconds) || 10)),
    reconnectMaxDelaySeconds: Math.min(600, Math.max(10, Number(input.reconnectMaxDelaySeconds) || 60)),
    connectionTimeoutSeconds: Math.min(180, Math.max(15, Number(input.connectionTimeoutSeconds) || 45)),
    networkStallTimeoutSeconds: Math.min(300, Math.max(30, Number(input.networkStallTimeoutSeconds) || 75)),
    tcpKeepAliveDelaySeconds: Math.min(300, Math.max(5, Number(input.tcpKeepAliveDelaySeconds) || 30)),
    proxyType: String(input.proxyType || 'SOCKS5').toUpperCase() === 'HTTP' ? 'HTTP' : 'SOCKS5',
    proxyHost: String(input.proxyHost || '').trim().slice(0, 255),
    proxyPort: Math.min(65535, Math.max(1, Number(input.proxyPort) || 1080)),
    proxyUsername: String(input.proxyUsername || '').slice(0, 255),
    proxyPassword: String(input.proxyPassword || '').slice(0, 255),
    discordMentionUserId: String(input.discordMentionUserId || '').replace(/\D/g, '').slice(0, 32),
    webhookPeriodicReportEnabled: input.webhookPeriodicReportEnabled !== false,
    webhookDeathAlertEnabled: input.webhookDeathAlertEnabled === true,
    webhookStrangerAlertEnabled: input.webhookStrangerAlertEnabled === true,
    webhookNoSellAlertEnabled: input.webhookNoSellAlertEnabled === true,
    webhookNoSellMinutes: numberInRange(input.webhookNoSellMinutes, 5, 1, 1440),
    webhookOfflineAlertEnabled: input.webhookOfflineAlertEnabled === true,
    discordWebhookIntervalMinutes: numberInRange(input.discordWebhookIntervalMinutes, 60, 1, 1440),
    strangerAction: ['notify', 'pause', 'disconnect'].includes(input.strangerAction)
      ? input.strangerAction
      : 'notify',
    version: '1.21.11',
    whitelistedPlayers: Array.isArray(input.whitelistedPlayers)
      ? input.whitelistedPlayers.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 200)
      : [],
    lastStats: { ...base.lastStats, ...(input.lastStats || {}) }
  }
}

class ProfileStore {
  constructor(dataDirectory) {
    this.directory = dataDirectory
    this.file = path.join(dataDirectory, 'profiles.json')
    fs.mkdirSync(dataDirectory, { recursive: true })
    this.profiles = this.#read()
  }

  #read() {
    try {
      if (!fs.existsSync(this.file)) return []
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.map(mergeProfile)
    } catch (error) {
      const brokenFile = `${this.file}.broken-${Date.now()}`
      try { fs.copyFileSync(this.file, brokenFile) } catch {}
      return []
    }
  }

  #write() {
    const temporary = `${this.file}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(this.profiles, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, this.file)
  }

  list() {
    return deepClone(this.profiles)
  }

  get(id) {
    const profile = this.profiles.find((item) => item.id === id)
    return profile ? deepClone(profile) : null
  }

  create(input) {
    const profile = mergeProfile(input)
    this.profiles.push(profile)
    this.#write()
    return deepClone(profile)
  }

  duplicate(id) {
    const source = this.profiles.find((item) => item.id === id)
    if (!source) throw new Error('Không tìm thấy profile')
    const baseName = `${source.name} (bản sao)`.slice(0, 48)
    let name = baseName
    let number = 2
    while (this.profiles.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      const suffix = ` (bản sao ${number})`
      name = `${source.name.slice(0, Math.max(1, 48 - suffix.length))}${suffix}`
      number += 1
    }
    const profile = mergeProfile({
      ...deepClone(source),
      id: crypto.randomUUID(),
      name,
      microsoftAccount: '',
      lastStats: deepClone(DEFAULT_PROFILE.lastStats)
    })
    this.profiles.push(profile)
    this.#write()
    return deepClone(profile)
  }

  update(id, patch) {
    const index = this.profiles.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('Không tìm thấy profile')
    const immutable = { id, version: '1.21.11' }
    this.profiles[index] = mergeProfile({ ...this.profiles[index], ...patch, ...immutable })
    this.#write()
    return deepClone(this.profiles[index])
  }

  updateMany(entries = []) {
    const updated = []
    for (const entry of entries) {
      const id = entry?.id
      const index = this.profiles.findIndex((item) => item.id === id)
      if (index < 0) continue
      const immutable = { id, version: '1.21.11' }
      this.profiles[index] = mergeProfile({ ...this.profiles[index], ...(entry.patch || {}), ...immutable })
      updated.push(deepClone(this.profiles[index]))
    }
    if (updated.length) this.#write()
    return updated
  }

  delete(id) {
    const before = this.profiles.length
    this.profiles = this.profiles.filter((item) => item.id !== id)
    if (this.profiles.length === before) return false
    this.#write()
    return true
  }
}

module.exports = {
  ProfileStore,
  DEFAULT_PROFILE,
  mergeProfile
}
