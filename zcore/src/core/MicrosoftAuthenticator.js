const { Authflow, Titles } = require('prismarine-auth')

const PROFILE_NOT_FOUND = 'MINECRAFT_PROFILE_NOT_FOUND'
const AUTH_REJECTED = 'MINECRAFT_AUTH_REJECTED'
const AUTH_UNAVAILABLE = 'MINECRAFT_AUTH_UNAVAILABLE'

function errorStatus(error) {
  const direct = Number(error?.status || error?.statusCode)
  if (Number.isInteger(direct) && direct >= 100 && direct <= 599) return direct
  const match = String(error?.message || error || '').match(/(?:^|\s)([1-5]\d{2})(?:\s|$)/)
  return match ? Number(match[1]) : null
}

function authError(code, message, cause, retryable, status = errorStatus(cause)) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  error.retryable = retryable
  error.status = status
  return error
}

function profileFetchError(error) {
  const status = errorStatus(error)
  if (status === 404) {
    return authError(
      PROFILE_NOT_FOUND,
      'Tài khoản Microsoft đã đăng nhập không có hồ sơ Minecraft Java.',
      error,
      false,
      status
    )
  }
  if (status === 400 || status === 401 || status === 403) {
    return authError(
      AUTH_REJECTED,
      'Phiên đăng nhập Microsoft không còn được Minecraft chấp nhận.',
      error,
      true,
      status
    )
  }
  return authError(
    AUTH_UNAVAILABLE,
    'Không thể kết nối tới dịch vụ xác thực Minecraft lúc này.',
    error,
    true,
    status
  )
}

async function fetchProfileWithOneTokenRefresh(authflow, token, fetchCertificates = true) {
  try {
    return { profile: await authflow.mca.fetchProfile(token), token }
  } catch (error) {
    if (errorStatus(error) !== 401) throw profileFetchError(error)
  }

  authflow.mca.forceRefresh = true
  try {
    const refreshed = await authflow.getMinecraftJavaToken({
      fetchProfile: false,
      fetchCertificates
    })
    try {
      return {
        profile: await authflow.mca.fetchProfile(refreshed.token),
        token: refreshed.token,
        certificates: refreshed.certificates
      }
    } catch (error) {
      throw profileFetchError(error)
    }
  } finally {
    authflow.mca.forceRefresh = false
  }
}

async function authenticateMicrosoft(client, options, AuthflowClass = Authflow) {
  if (!options.profilesFolder) throw new Error('Thiếu thư mục lưu phiên đăng nhập Microsoft')
  if (options.authTitle === undefined) {
    options.authTitle = Titles.MinecraftNintendoSwitch
    options.deviceType = 'Nintendo'
    options.flow = 'live'
  }

  if (!client.authflow) {
    client.authflow = new AuthflowClass(
      options.username,
      options.profilesFolder,
      options,
      options.onMsaCode
    )
  }

  let credentials
  try {
    credentials = await client.authflow.getMinecraftJavaToken({
      fetchProfile: false,
      fetchCertificates: !options.disableChatSigning
    })
  } catch (error) {
    throw authError(
      AUTH_UNAVAILABLE,
      'Không thể hoàn tất đăng nhập Microsoft/Xbox.',
      error,
      true
    )
  }

  const resolved = await fetchProfileWithOneTokenRefresh(
    client.authflow,
    credentials.token,
    !options.disableChatSigning
  )
  const profile = resolved.profile
  if (!profile || profile.error || !profile.id || !profile.name) {
    throw authError(
      AUTH_UNAVAILABLE,
      'Dịch vụ Minecraft trả về hồ sơ người chơi không hợp lệ.',
      null,
      true
    )
  }

  options.haveCredentials = Boolean(resolved.token)
  options.accessToken = resolved.token
  Object.assign(client, resolved.certificates || credentials.certificates || {})
  client.session = {
    accessToken: resolved.token,
    selectedProfile: profile,
    availableProfile: [profile]
  }
  client.username = profile.name
  client.emit('session', client.session)
  options.connect(client)
}

function microsoftAuthenticator(client, options) {
  authenticateMicrosoft(client, options).catch((error) => client.emit('error', error))
}

module.exports = {
  PROFILE_NOT_FOUND,
  AUTH_REJECTED,
  AUTH_UNAVAILABLE,
  errorStatus,
  profileFetchError,
  fetchProfileWithOneTokenRefresh,
  authenticateMicrosoft,
  microsoftAuthenticator
}
