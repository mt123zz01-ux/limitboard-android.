const test = require('node:test')
const assert = require('node:assert/strict')
const { StatsTracker } = require('../src/core/StatsTracker')

test('đọc tiền từ thông báo sell theo K/M/B', () => {
  const tracker = new StatsTracker()
  assert.equal(tracker.parseMessage('Bạn đã bán vật phẩm +$2.5M', false, { saleContext: true, saleId: 1 }), 2_500_000)
  assert.equal(tracker.parseMessage('Sell thành công: $750K', false, { saleContext: true, saleId: 2 }), 750_000)
  assert.equal(tracker.parseMessage('+$1B', true, { saleContext: true, saleId: 3 }), 1_000_000_000)
  assert.equal(tracker.totalSalesCount, 3)
  assert.equal(tracker.totalEarned, 1_003_250_000)
})

test('không tính chat, balance, pay hoặc dòng tiền không phải lượt Auto Sell', () => {
  const tracker = new StatsTracker()
  const sale = { saleContext: true, saleId: 1 }
  assert.equal(tracker.parseMessage('<Player> tôi có $10M', false, sale), null)
  assert.equal(tracker.parseMessage('Balance: $10M', false, sale), null)
  assert.equal(tracker.parseMessage('You have $80,055,020', false, sale), null)
  assert.equal(tracker.parseMessage('You paid Player $2M', false, sale), null)
  assert.equal(tracker.parseMessage('You have paid Player $2M', false, sale), null)
  assert.equal(tracker.parseMessage('Payment sent: $1M', false, sale), null)
  assert.equal(tracker.parseMessage('Player paid you $3M', false, sale), null)
  assert.equal(tracker.parseMessage('Your balance is $4M', false, sale), null)
  assert.equal(tracker.parseMessage('You sold items for $1M'), null)
  assert.equal(tracker.totalSalesCount, 0)
})

test('mỗi lần xác nhận Auto Sell chỉ được tính một lần', () => {
  const tracker = new StatsTracker()
  const sale = { saleContext: true, saleId: 9 }
  assert.equal(tracker.parseMessage('You sold items for $34.8K', false, sale), 34_800)
  assert.equal(tracker.parseMessage('+$34.8K', true, sale), null)
  assert.equal(tracker.totalSalesCount, 1)
  assert.equal(StatsTracker.formatCurrency(tracker.totalEarned), '$34.80K')
})

test('đọc đúng số tiền sell có dấu phân cách hàng nghìn', () => {
  const tracker = new StatsTracker()
  assert.equal(tracker.parseMessage('You sold 64 items for $80,055,020', false, { saleContext: true, saleId: 10 }), 80_055_020)
  assert.equal(tracker.totalEarned, 80_055_020)
})
