const test = require('node:test')
const assert = require('node:assert/strict')
const { BotSession, STRANGER_PAUSE_REASON } = require('../src/core/BotSession')
const { mergeProfile } = require('../src/core/ProfileStore')

function sessionWith(patch = {}) {
  const profile = mergeProfile({
    name: 'Test',
    host: 'server.test',
    discordWebhookEnabled: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/1/token',
    ...patch
  })
  return new BotSession(profile, '/tmp/zcore-test-auth')
}

test('watch không sell chỉ tạo timer khi Auto Sell, Webhook và lựa chọn đều bật', () => {
  const enabled = sessionWith({ autoSellEnabled: true, webhookNoSellAlertEnabled: true })
  enabled.status = 'online'
  enabled.connectedAt = Date.now()
  enabled.startNoSellWatch()
  assert.ok(enabled.noSellTimer)
  enabled.stopRuntimeTimers(false)

  const disabled = sessionWith({ autoSellEnabled: false, webhookNoSellAlertEnabled: true })
  disabled.status = 'online'
  disabled.startNoSellWatch()
  assert.equal(disabled.noSellTimer, null)
})

test('sell hoàn tất đặt lại mốc cảnh báo không sell', () => {
  const session = sessionWith({ webhookNoSellAlertEnabled: true })
  session.status = 'online'
  session.connectedAt = Date.now() - 100_000
  session.lastNoSellAlertAt = Date.now() - 50_000
  const soldAt = Date.now()
  session.markConfirmedSale(soldAt)
  assert.equal(session.lastConfirmedSaleAt, soldAt)
  assert.equal(session.lastNoSellAlertAt, 0)
  assert.ok(session.noSellTimer)
  session.stopRuntimeTimers(false)
})

test('chế độ người lạ notify không dừng Auto Sell', async () => {
  const session = sessionWith({ whitelistGuardEnabled: true, strangerAction: 'notify' })
  let paused = false
  session.controller = { pause: () => { paused = true } }
  session.bot = { username: 'Bot', entity: { position: { x: 0, y: 64, z: 0 } } }
  await session.handleStranger('Guest', 4)
  assert.equal(paused, false)
  assert.equal(session.blockedByProtection, false)
})

test('chế độ người lạ pause dùng lý do riêng để có thể tự resume', async () => {
  const session = sessionWith({ whitelistGuardEnabled: true, strangerAction: 'pause' })
  let reason = ''
  session.controller = { pause: (value) => { reason = value } }
  session.bot = { username: 'Bot', entity: { position: { x: 0, y: 64, z: 0 } } }
  await session.handleStranger('Guest', 4)
  assert.equal(reason, STRANGER_PAUSE_REASON)
  assert.equal(session.blockedByProtection, false)
})

test('chế độ người lạ disconnect dừng controller và khóa reconnect', async () => {
  const session = sessionWith({ whitelistGuardEnabled: true, strangerAction: 'disconnect' })
  let stopped = 0
  let quitReason = ''
  session.controller = { stop: () => { stopped += 1 } }
  session.homeController = { stop: () => { stopped += 1 } }
  session.bot = {
    username: 'Bot',
    entity: { position: { x: 0, y: 64, z: 0 } },
    quit: (reason) => { quitReason = reason }
  }
  await session.handleStranger('Guest', 4)
  assert.equal(session.blockedByProtection, true)
  assert.equal(stopped, 2)
  assert.match(quitReason, /Guest/)
})

test('cảnh báo người lạ không bật guard chỉ thông báo, không áp dụng out game', async () => {
  const session = sessionWith({
    whitelistGuardEnabled: false,
    webhookStrangerAlertEnabled: true,
    strangerAction: 'disconnect'
  })
  session.sendAlertWebhook = () => Promise.resolve(true)
  let quit = false
  session.bot = {
    username: 'Bot',
    entity: { position: { x: 0, y: 64, z: 0 } },
    quit: () => { quit = true }
  }
  await session.handleStranger('Guest', 4)
  assert.equal(quit, false)
  assert.equal(session.blockedByProtection, false)
})
