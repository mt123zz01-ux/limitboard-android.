const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ProfileStore, mergeProfile } = require('../src/core/ProfileStore')

test('tạo, cập nhật và đọc lại nhiều profile', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)
  const first = store.create({ name: 'acc chính', host: 'donutsmp.net', port: 25565 })
  store.create({ name: 'acc phụ', host: 'example.net', port: 25566 })
  store.update(first.id, { autoSellEnabled: false })

  const reloaded = new ProfileStore(directory)
  assert.equal(reloaded.list().length, 2)
  assert.equal(reloaded.get(first.id).autoSellEnabled, false)
  assert.equal(reloaded.get(first.id).version, '1.21.11')
})

test('port được giới hạn trong phạm vi hợp lệ', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)
  assert.equal(store.create({ host: 'server.net', port: 99_999 }).port, 65_535)
  assert.equal(store.create({ host: 'server.net', port: 0 }).port, 25_565)
})

test('chuẩn hóa thiết lập proxy và kết nối ổn định', () => {
  const profile = mergeProfile({
    proxyEnabled: true,
    proxyType: 'http',
    proxyHost: ' proxy.local ',
    proxyPort: 8080,
    reconnectDelaySeconds: 0,
    connectionTimeoutSeconds: 2,
    tcpKeepAliveDelaySeconds: 1
  })
  assert.equal(profile.proxyType, 'HTTP')
  assert.equal(profile.proxyHost, 'proxy.local')
  assert.equal(profile.proxyPort, 8080)
  assert.equal(profile.reconnectDelaySeconds, 10)
  assert.equal(profile.connectionTimeoutSeconds, 15)
  assert.equal(profile.tcpKeepAliveDelaySeconds, 5)
})

test('xóa hoàn toàn sellSettings khỏi profile và vẫn chuẩn hóa Webhook', () => {
  const profile = mergeProfile({
    discordWebhookIntervalMinutes: 15,
    sellSettings: {
      moveDelayMinTicks: 9,
      cycleDelayMaxTicks: 20
    }
  })
  assert.equal(profile.discordWebhookIntervalMinutes, 15)
  assert.equal(Object.hasOwn(profile, 'sellSettings'), false)
  assert.equal(mergeProfile({ discordWebhookIntervalMinutes: 0 }).discordWebhookIntervalMinutes, 1)
})

test('ProfileStore không ghi sellSettings cũ trở lại file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)
  const profile = store.create({
    name: 'legacy',
    host: 'server.net',
    sellSettings: { moveDelayTicks: 7, itemsPerTick: 4 }
  })

  assert.equal(Object.hasOwn(profile, 'sellSettings'), false)
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'profiles.json'), 'utf8'))
  assert.equal(Object.hasOwn(saved[0], 'sellSettings'), false)
})

test('worker riêng mặc định bật và có thể tắt theo từng profile', () => {
  assert.equal(mergeProfile({}).workerEnabled, true)
  assert.equal(mergeProfile({ workerEnabled: false }).workerEnabled, false)
  assert.equal(mergeProfile({}).afkLiteEnabled, true)
  assert.equal(mergeProfile({ afkLiteEnabled: false }).afkLiteEnabled, false)
  assert.equal(mergeProfile({}).balanceCommandEnabled, true)
  assert.equal(mergeProfile({ balanceCommandEnabled: false }).balanceCommandEnabled, false)
  assert.equal(mergeProfile({}).balanceTrackingEnabled, true)
  assert.equal(mergeProfile({ balanceTrackingEnabled: false }).balanceTrackingEnabled, false)
  assert.equal(mergeProfile({}).clientEngine, 'protocol')
  assert.equal(mergeProfile({ clientEngine: 'mineflayer' }).clientEngine, 'mineflayer')
  assert.equal(mergeProfile({ clientEngine: 'unknown' }).clientEngine, 'protocol')
})

test('chuẩn hóa toàn bộ delay Auto Sell và Auto Home', () => {
  const profile = mergeProfile({
    autoSellDelaySeconds: 2.5,
    autoSellRandomDelayEnabled: true,
    autoSellDelayMinSeconds: 9,
    autoSellDelayMaxSeconds: 3,
    autoSellInventoryCheckDelayMinSeconds: 0.8,
    autoSellInventoryCheckDelayMaxSeconds: 0.5,
    autoSellQuickAllDelayMinSeconds: 0.2,
    autoSellQuickAllDelayMaxSeconds: 0.1,
    autoSellMoveDelayMinSeconds: 0.9,
    autoSellMoveDelayMaxSeconds: 0.4,
    autoSellGuiTimeoutSeconds: 4,
    autoSellErrorCooldownSeconds: 2,
    autoSellTickMilliseconds: 10,
    autoHomeEnabled: true,
    autoHomeNumber: 9,
    autoHomeDelayMinutes: 0
  })
  assert.equal(profile.autoSellDelaySeconds, 2.5)
  assert.equal(profile.autoSellRandomDelayEnabled, true)
  assert.equal(profile.autoSellDelayMinSeconds, 3)
  assert.equal(profile.autoSellDelayMaxSeconds, 9)
  assert.equal(profile.autoSellInventoryCheckDelayMinSeconds, 0.5)
  assert.equal(profile.autoSellInventoryCheckDelayMaxSeconds, 0.8)
  assert.equal(profile.autoSellQuickAllDelayMinSeconds, 0.1)
  assert.equal(profile.autoSellQuickAllDelayMaxSeconds, 0.2)
  assert.equal(profile.autoSellMoveDelayMinSeconds, 0.4)
  assert.equal(profile.autoSellMoveDelayMaxSeconds, 0.9)
  assert.equal(profile.autoSellGuiTimeoutSeconds, 4)
  assert.equal(profile.autoSellErrorCooldownSeconds, 2)
  assert.equal(profile.autoSellTickMilliseconds, 20)
  assert.equal(profile.autoHomeEnabled, true)
  assert.equal(profile.autoHomeNumber, 4)
  assert.equal(profile.autoHomeDelayMinutes, 1)
  assert.equal(mergeProfile({ autoSellDelaySeconds: 0 }).autoSellDelaySeconds, 0.05)
  assert.equal(mergeProfile({ autoSellDelaySeconds: 999 }).autoSellDelaySeconds, 60)
})

test('Auto Sell dùng mặc định nhanh khuyên dùng và Auto Home mặc định tắt', () => {
  const profile = mergeProfile({})
  assert.equal(profile.autoSellDelaySeconds, 0.2)
  assert.equal(profile.autoSellRandomDelayEnabled, true)
  assert.equal(profile.autoSellDelayMinSeconds, 0.15)
  assert.equal(profile.autoSellDelayMaxSeconds, 0.3)
  assert.equal(profile.autoHomeEnabled, false)
  assert.equal(profile.autoHomeNumber, 1)
  assert.equal(profile.autoHomeDelayMinutes, 5)
  assert.equal(profile.autoSellInventoryCheckDelayMinSeconds, 0.1)
  assert.equal(profile.autoSellInventoryCheckDelayMaxSeconds, 0.2)
  assert.equal(profile.autoSellQuickAllDelayMinSeconds, 0.05)
  assert.equal(profile.autoSellQuickAllDelayMaxSeconds, 0.1)
  assert.equal(profile.autoSellMoveDelayMinSeconds, 0.25)
  assert.equal(profile.autoSellMoveDelayMaxSeconds, 0.4)
  assert.equal(profile.autoSellGuiTimeoutSeconds, 3)
  assert.equal(profile.autoSellErrorCooldownSeconds, 1)
  assert.equal(profile.autoSellTickMilliseconds, 50)
  assert.equal(profile.autoSellAxeEnabled, false)
  assert.equal(profile.autoSellAxeLookUpEnabled, true)
})

test('AutoSellAxe và Auto Sell loại trừ nhau trong dữ liệu profile', () => {
  const axe = mergeProfile({
    autoSellEnabled: true,
    autoSellAxeEnabled: true,
    autoSellAxeLookUpEnabled: false
  })
  assert.equal(axe.autoSellEnabled, false)
  assert.equal(axe.autoSellAxeEnabled, true)
  assert.equal(axe.autoSellAxeLookUpEnabled, false)

  const sell = mergeProfile({ autoSellEnabled: true, autoSellAxeEnabled: false })
  assert.equal(sell.autoSellEnabled, true)
  assert.equal(sell.autoSellAxeEnabled, false)
})

test('updateMany cập nhật nhiều thống kê nhưng chỉ ghi một lần logic', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)
  const first = store.create({ name: 'batch-1', host: 'server.net' })
  const second = store.create({ name: 'batch-2', host: 'server.net' })
  const updated = store.updateMany([
    { id: first.id, patch: { lastStats: { totalEarned: 100 } } },
    { id: second.id, patch: { lastStats: { totalEarned: 200 } } }
  ])
  assert.equal(updated.length, 2)
  assert.equal(store.get(first.id).lastStats.totalEarned, 100)
  assert.equal(store.get(second.id).lastStats.totalEarned, 200)
})

test('chuẩn hóa các lựa chọn cảnh báo Webhook và Discord User ID', () => {
  const profile = mergeProfile({
    discordMentionUserId: ' <@123456789012345678> ',
    webhookPeriodicReportEnabled: false,
    webhookDeathAlertEnabled: true,
    webhookStrangerAlertEnabled: true,
    webhookNoSellAlertEnabled: true,
    webhookNoSellMinutes: 0,
    webhookOfflineAlertEnabled: true,
    strangerAction: 'pause'
  })
  assert.equal(profile.discordMentionUserId, '123456789012345678')
  assert.equal(profile.webhookPeriodicReportEnabled, false)
  assert.equal(profile.webhookDeathAlertEnabled, true)
  assert.equal(profile.webhookStrangerAlertEnabled, true)
  assert.equal(profile.webhookNoSellAlertEnabled, true)
  assert.equal(profile.webhookNoSellMinutes, 1)
  assert.equal(profile.webhookOfflineAlertEnabled, true)
  assert.equal(profile.strangerAction, 'pause')
})

test('sao chép profile giữ setting nhưng tách ID, tài khoản, token và thống kê', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-copy-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)
  const source = store.create({
    name: 'Farm 1',
    microsoftAccount: 'first@example.com',
    host: 'server.net',
    proxyEnabled: true,
    discordWebhookEnabled: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/1/token',
    webhookNoSellAlertEnabled: true,
    webhookNoSellMinutes: 10,
    strangerAction: 'disconnect',
    lastStats: { totalEarned: 999, totalSalesCount: 4 }
  })
  const copy = store.duplicate(source.id)
  assert.notEqual(copy.id, source.id)
  assert.equal(copy.name, 'Farm 1 (bản sao)')
  assert.equal(copy.microsoftAccount, '')
  assert.equal(copy.host, source.host)
  assert.equal(copy.proxyEnabled, true)
  assert.equal(copy.discordWebhookUrl, source.discordWebhookUrl)
  assert.equal(copy.webhookNoSellMinutes, 10)
  assert.equal(copy.strangerAction, 'disconnect')
  assert.equal(copy.lastStats.totalEarned, 0)
  assert.equal(copy.lastStats.totalSalesCount, 0)
})
