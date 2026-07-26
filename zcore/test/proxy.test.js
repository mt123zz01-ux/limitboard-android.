const test = require('node:test')
const assert = require('node:assert/strict')
const { validateProxy } = require('../src/core/ProxyConnector')

test('proxy tắt không can thiệp kết nối trực tiếp', () => {
  assert.equal(validateProxy({ proxyEnabled: false }), null)
})

test('proxy từ chối host và port không hợp lệ', () => {
  assert.throws(() => validateProxy({ proxyEnabled: true, proxyHost: 'bad host', proxyPort: 1080 }), /không hợp lệ/)
  assert.throws(() => validateProxy({ proxyEnabled: true, proxyHost: 'localhost', proxyPort: 70000 }), /1–65535/)
})
