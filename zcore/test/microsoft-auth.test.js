const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  PROFILE_NOT_FOUND,
  AUTH_REJECTED,
  AUTH_UNAVAILABLE,
  errorStatus,
  profileFetchError,
  authenticateMicrosoft
} = require('../src/core/MicrosoftAuthenticator')

function httpError(status, text = 'failure') {
  const error = new Error(`${status} HTTP ${text}`)
  error.status = status
  return error
}

test('phân loại đúng lỗi profile thay vì gom tất cả thành chưa mua Minecraft', () => {
  assert.equal(errorStatus(httpError(404)), 404)
  assert.equal(errorStatus(new Error('503 Service Unavailable')), 503)

  const missing = profileFetchError(httpError(404, 'Not Found'))
  assert.equal(missing.code, PROFILE_NOT_FOUND)
  assert.equal(missing.retryable, false)

  const rejected = profileFetchError(httpError(401, 'Unauthorized'))
  assert.equal(rejected.code, AUTH_REJECTED)
  assert.equal(rejected.retryable, true)

  const unavailable = profileFetchError(new TypeError('fetch failed'))
  assert.equal(unavailable.code, AUTH_UNAVAILABLE)
  assert.equal(unavailable.retryable, true)
})

test('auth tùy chỉnh tạo session và giữ profile Minecraft hợp lệ', async () => {
  class FakeAuthflow {
    constructor(username, folder, options, callback) {
      this.createdWith = { username, folder, options, callback }
      this.mca = {
        forceRefresh: false,
        fetchProfile: async () => ({ id: 'uuid-1', name: 'ZCoreTester' })
      }
    }

    async getMinecraftJavaToken() {
      return {
        token: 'token-1',
        certificates: { profileKeys: { marker: 'certificate-1' } }
      }
    }
  }

  const client = new EventEmitter()
  let connected = false
  let emittedSession = null
  client.once('session', (session) => { emittedSession = session })
  const options = {
    username: 'acc@example.com',
    profilesFolder: '/tmp/zcore-auth-test',
    onMsaCode: () => {},
    connect: () => { connected = true }
  }

  await authenticateMicrosoft(client, options, FakeAuthflow)

  assert.equal(connected, true)
  assert.equal(client.username, 'ZCoreTester')
  assert.equal(client.session.accessToken, 'token-1')
  assert.equal(client.profileKeys.marker, 'certificate-1')
  assert.equal(emittedSession.selectedProfile.id, 'uuid-1')
  assert.equal(options.flow, 'live')
})

test('profile 401 làm mới Minecraft token đúng một lần rồi tiếp tục', async () => {
  class RefreshingAuthflow {
    constructor() {
      this.tokenCalls = 0
      this.profileCalls = 0
      this.mca = {
        forceRefresh: false,
        fetchProfile: async () => {
          this.profileCalls += 1
          if (this.profileCalls === 1) throw httpError(401, 'expired token')
          return { id: 'uuid-2', name: 'RefreshedPlayer' }
        }
      }
    }

    async getMinecraftJavaToken() {
      this.tokenCalls += 1
      return {
        token: `token-${this.tokenCalls}`,
        certificates: { profileKeys: { marker: `certificate-${this.tokenCalls}` } }
      }
    }
  }

  const client = new EventEmitter()
  const options = {
    username: 'refresh@example.com',
    profilesFolder: '/tmp/zcore-auth-refresh-test',
    connect: () => {}
  }

  await authenticateMicrosoft(client, options, RefreshingAuthflow)

  assert.equal(client.authflow.tokenCalls, 2)
  assert.equal(client.authflow.profileCalls, 2)
  assert.equal(client.authflow.mca.forceRefresh, false)
  assert.equal(client.session.accessToken, 'token-2')
  assert.equal(client.profileKeys.marker, 'certificate-2')
})

test('profile 404 dừng với lỗi sở hữu rõ ràng', async () => {
  class MissingProfileAuthflow {
    constructor() {
      this.mca = {
        forceRefresh: false,
        fetchProfile: async () => { throw httpError(404, 'Not Found') }
      }
    }

    async getMinecraftJavaToken() {
      return { token: 'token-without-game' }
    }
  }

  const client = new EventEmitter()
  const options = {
    username: 'missing@example.com',
    profilesFolder: '/tmp/zcore-auth-missing-test',
    connect: () => assert.fail('không được mở kết nối server')
  }

  await assert.rejects(
    authenticateMicrosoft(client, options, MissingProfileAuthflow),
    (error) => error.code === PROFILE_NOT_FOUND && error.retryable === false
  )
})
