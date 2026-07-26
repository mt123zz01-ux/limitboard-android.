const test = require('node:test')
const assert = require('node:assert/strict')
const { alertPayload, mentionEnvelope } = require('../src/core/DiscordWebhook')
const { webhookNoSellMs, strangerActionLabel } = require('../src/core/BotSession')

const profile = {
  name: 'Farm 1',
  host: 'server.test',
  port: 25565,
  discordMentionUserId: '123456789012345678'
}

test('payload cảnh báo tag đúng user mà không cho Discord parse mention tùy ý', () => {
  assert.deepEqual(mentionEnvelope(profile), {
    content: '<@123456789012345678>',
    allowed_mentions: { parse: [], users: ['123456789012345678'] }
  })
  const payload = alertPayload(profile, 'Player', 'no-sell', { minutes: 10 })
  assert.equal(payload.content, '<@123456789012345678>')
  assert.match(payload.embeds[0].title, /Không có lượt bán/)
  assert.match(payload.embeds[0].fields.at(-1).value, /ONLINE/)
})

test('payload chết, người lạ và offline có đủ thông tin profile', () => {
  for (const [type, details] of [
    ['death', {}],
    ['stranger', { player: 'UnknownGuy', distance: 4.2, action: 'Tạm dừng Auto Sell' }],
    ['offline', { reason: 'timeout' }]
  ]) {
    const payload = alertPayload(profile, 'Player', type, details)
    assert.equal(payload.embeds[0].fields[0].value, 'Farm 1')
    assert.equal(payload.embeds[0].fields[1].value, 'Player')
    assert.equal(payload.embeds[0].fields[2].value, 'server.test:25565')
  }
})

test('delay không sell giới hạn 1–1440 phút và action có nhãn dễ hiểu', () => {
  assert.equal(webhookNoSellMs({ webhookNoSellMinutes: 0 }), 60_000)
  assert.equal(webhookNoSellMs({ webhookNoSellMinutes: 10 }), 600_000)
  assert.equal(webhookNoSellMs({ webhookNoSellMinutes: 5000 }), 86_400_000)
  assert.match(strangerActionLabel('pause'), /Tạm dừng/)
  assert.match(strangerActionLabel('disconnect'), /Thoát game/)
})
