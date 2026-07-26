const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeChatInput } = require('../src/core/BotSession')

test('giữ nguyên lệnh /pay cùng tên người chơi và số tiền', () => {
  assert.equal(normalizeChatInput('  /pay user 1000  '), '/pay user 1000')
})

test('từ chối lệnh trống hoặc dài quá giới hạn', () => {
  assert.throws(() => normalizeChatInput('   '), /trống/)
  assert.throws(() => normalizeChatInput('x'.repeat(257)), /quá dài/)
})
