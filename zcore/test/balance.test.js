const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  BalanceTracker,
  parseBalanceText,
  parseBalanceCommandResponse,
  parseCurrencyText,
  BALANCE_POLL_INTERVAL_MS
} = require('../src/core/BalanceTracker')

test('đọc số dư K/M/B từ chat hoặc actionbar nhưng bỏ qua thông báo sell', () => {
  assert.equal(parseBalanceText('Balance: $1.5M'), 1_500_000)
  assert.equal(parseBalanceText('Money: $12,345.67'), 12_345.67)
  assert.equal(parseBalanceText('Số dư: 500K'), 500_000)
  assert.equal(parseBalanceText('Wallet > 1.234.567,89đ'), 1_234_567.89)
  assert.equal(parseBalanceText('You have $80,055,020'), 80_055_020)
  assert.equal(parseBalanceText('You have 5 items'), null)
  assert.equal(parseBalanceText('You have paid Player $2M'), null)
  assert.equal(parseBalanceText('Bạn đã bán vật phẩm +$2.5M'), null)
  assert.equal(parseCurrencyText('$ 670M'), 670_000_000)
  assert.equal(BALANCE_POLL_INTERVAL_MS, 5_000)
})

test('phản hồi /balance dùng parser nghiêm ngặt và không nhận pay, sell hoặc chat người chơi', () => {
  assert.equal(parseBalanceCommandResponse('You have $ 80,055,020'), 80_055_020)
  assert.equal(parseBalanceCommandResponse('Your balance is $1.25B'), 1_250_000_000)
  assert.equal(parseBalanceCommandResponse('Balance: 670M'), 670_000_000)
  assert.equal(parseBalanceCommandResponse('Số dư của bạn: 1.234.567đ'), 1_234_567)
  assert.equal(parseBalanceCommandResponse('Bạn có $49.1K'), 49_100)

  assert.equal(parseBalanceCommandResponse('You have paid Player $2M'), null)
  assert.equal(parseBalanceCommandResponse('You have received $3M'), null)
  assert.equal(parseBalanceCommandResponse('You sold items for $4M'), null)
  assert.equal(parseBalanceCommandResponse('<Player> You have $999M'), null)
  assert.equal(parseBalanceCommandResponse('Your balance increased by $5M'), null)
  assert.equal(parseBalanceCommandResponse('You have 64 items'), null)
})

test('đọc số dư hiện tại từ scoreboard sidebar', () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.scoreboard = {
    sidebar: {
      title: 'DONUT SMP',
      items: [
        { displayName: { toString: () => 'Kills: 10' } },
        { displayName: { toString: () => 'Balance: $3.25M' } }
      ]
    }
  }
  const changes = []
  const tracker = new BalanceTracker((snapshot) => changes.push(snapshot))
  tracker.attach(bot)
  tracker.scanAll()

  assert.equal(tracker.snapshot().amount, 3_250_000)
  assert.equal(tracker.snapshot().source, 'scoreboard')
  assert.equal(changes.at(-1).amount, 3_250_000)
  tracker.detach()
})

test('đọc $670M từ scoreboard below-name của đúng nhân vật', () => {
  const client = new EventEmitter()
  const bot = new EventEmitter()
  bot._client = client
  bot.username = 'Ugwen20'
  bot.scoreboard = {}
  const tracker = new BalanceTracker()
  tracker.attach(bot)

  client.emit('scoreboard_objective', { name: 'money', action: 0, displayText: '$' })
  client.emit('scoreboard_display_objective', { position: 2, name: 'money' })
  client.emit('scoreboard_score', {
    itemName: 'Ugwen20', scoreName: 'money', value: 670,
    styling: { type: 'compound', value: { text: { type: 'string', value: '$ 670M' } } }
  })
  tracker.scanAll()

  assert.equal(tracker.snapshot().amount, 670_000_000)
  assert.equal(tracker.snapshot().source, 'below-name')
  assert.equal(tracker.snapshot().pollIntervalMs, 5_000)
  tracker.detach()
})

test('/balance là nguồn chính: không poll scoreboard và cập nhật từ phản hồi chat', () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.scoreboard = {}
  const tracker = new BalanceTracker()
  tracker.attach(bot, { pollScoreboard: false })

  assert.equal(tracker.snapshot().scoreboardPollingEnabled, false)
  assert.equal(tracker.snapshot().pollIntervalMs, null)
  assert.equal(bot._client.listenerCount('scoreboard_score'), 0)
  assert.equal(tracker.observeText('You have $80,055,020', 'balance-command'), 80_055_020)
  assert.equal(tracker.snapshot().amount, 80_055_020)
  assert.equal(tracker.snapshot().source, 'balance-command')
  tracker.detach()
})

test('listener scoreboard chỉ được nạp khi thật sự bật fallback', () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  const tracker = new BalanceTracker()
  tracker.attach(bot, { pollScoreboard: false })
  assert.equal(bot._client.listenerCount('scoreboard_objective'), 0)
  tracker.setScoreboardPolling(true)
  assert.equal(bot._client.listenerCount('scoreboard_objective'), 1)
  tracker.setScoreboardPolling(false)
  assert.equal(bot._client.listenerCount('scoreboard_objective'), 0)
  tracker.detach()
})
