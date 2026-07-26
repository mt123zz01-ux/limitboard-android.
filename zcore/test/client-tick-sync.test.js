const test = require('node:test')
const assert = require('node:assert/strict')
const { ClientTickSync } = require('../src/core/ClientTickSync')

test('gửi tick_end 1.21.11 khi phiên đang online', () => {
  const packets = []
  let online = true
  const sync = new ClientTickSync({ write: (...args) => packets.push(args) }, () => online)

  assert.equal(sync.sendTickEnd(), true)
  online = false
  assert.equal(sync.sendTickEnd(), false)
  assert.deepEqual(packets, [['tick_end', {}]])
})

test('lỗi tick_end chỉ được báo một lần để tránh spam log', () => {
  let reported = 0
  const sync = new ClientTickSync(
    { write: () => { throw new Error('serializer') } },
    () => true,
    () => { reported += 1 }
  )

  assert.equal(sync.sendTickEnd(), false)
  assert.equal(sync.sendTickEnd(), false)
  assert.equal(reported, 1)
})
