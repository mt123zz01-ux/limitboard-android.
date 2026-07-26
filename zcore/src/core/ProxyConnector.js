const net = require('node:net')

function proxyError(message) {
  const error = new Error(`Proxy: ${message}`)
  error.code = 'ZCORE_PROXY_ERROR'
  return error
}

function validateProxy(profile) {
  if (!profile.proxyEnabled) return null
  const type = String(profile.proxyType || 'SOCKS5').toUpperCase()
  const host = String(profile.proxyHost || '').trim()
  const port = Number(profile.proxyPort)
  const username = String(profile.proxyUsername || '')
  const password = String(profile.proxyPassword || '')
  if (!['HTTP', 'SOCKS5'].includes(type)) throw proxyError('chỉ hỗ trợ HTTP hoặc SOCKS5')
  if (!host || /[\s/\\]/.test(host)) throw proxyError('địa chỉ không hợp lệ')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw proxyError('port phải nằm trong 1–65535')
  if (Buffer.byteLength(username) > 255) throw proxyError('tên đăng nhập quá dài')
  if (Buffer.byteLength(password) > 255) throw proxyError('mật khẩu quá dài')
  return { type, host, port, username, password }
}

function readUntil(socket, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => finish(proxyError('hết thời gian chờ phản hồi')), timeoutMs)
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 64 * 1024) return finish(proxyError('phản hồi quá lớn'))
      const result = predicate(buffer)
      if (result) finish(null, result)
    }
    const onError = (error) => finish(error)
    const onClose = () => finish(proxyError('kết nối bị đóng trong lúc bắt tay'))
    function finish(error, value) {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (error) reject(error)
      else resolve(value)
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

async function httpHandshake(socket, targetHost, targetPort, proxy, timeoutMs) {
  const authority = `${targetHost}:${targetPort}`
  const headers = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`, 'Proxy-Connection: Keep-Alive']
  if (proxy.username || proxy.password) {
    headers.push(`Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`)
  }
  socket.write(`${headers.join('\r\n')}\r\n\r\n`)
  const response = await readUntil(socket, (buffer) => {
    const end = buffer.indexOf('\r\n\r\n')
    return end < 0 ? null : buffer.subarray(0, end + 4)
  }, timeoutMs)
  const firstLine = response.toString('latin1').split('\r\n', 1)[0]
  const status = Number(firstLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/)?.[1])
  if (status !== 200) throw proxyError(`HTTP CONNECT thất bại (${firstLine || 'không có mã trạng thái'})`)
}

async function socksHandshake(socket, targetHost, targetPort, proxy, timeoutMs) {
  const useAuth = Boolean(proxy.username || proxy.password)
  socket.write(Buffer.from(useAuth ? [5, 2, 0, 2] : [5, 1, 0]))
  const greeting = await readUntil(socket, (buffer) => buffer.length >= 2 ? buffer.subarray(0, 2) : null, timeoutMs)
  if (greeting[0] !== 5 || greeting[1] === 0xff) throw proxyError('SOCKS5 không chấp nhận phương thức xác thực')
  if (greeting[1] === 2) {
    const user = Buffer.from(proxy.username)
    const pass = Buffer.from(proxy.password)
    socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]))
    const auth = await readUntil(socket, (buffer) => buffer.length >= 2 ? buffer.subarray(0, 2) : null, timeoutMs)
    if (auth[1] !== 0) throw proxyError('sai tài khoản hoặc mật khẩu SOCKS5')
  } else if (greeting[1] !== 0) {
    throw proxyError(`phương thức SOCKS5 không hỗ trợ: ${greeting[1]}`)
  }

  const host = Buffer.from(targetHost)
  if (host.length > 255) throw proxyError('địa chỉ server quá dài')
  const port = Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, port]))
  const reply = await readUntil(socket, (buffer) => {
    if (buffer.length < 5) return null
    const atyp = buffer[3]
    const length = atyp === 1 ? 4 : atyp === 4 ? 16 : atyp === 3 ? 1 + buffer[4] : -1
    if (length < 0) return Buffer.from([5, 8])
    const total = 4 + length + 2
    return buffer.length >= total ? buffer.subarray(0, total) : null
  }, timeoutMs)
  if (reply[0] !== 5 || reply[1] !== 0) throw proxyError(`SOCKS5 từ chối kết nối (mã ${reply[1]})`)
}

function createProxyConnect(profile, log = () => {}) {
  const proxy = validateProxy(profile)
  if (!proxy) return null
  const targetHost = String(profile.host).trim()
  const targetPort = Number(profile.port) || 25565
  const timeoutMs = Math.max(5_000, Number(profile.connectionTimeoutSeconds || 45) * 1000)

  return (client) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port })
    socket.setNoDelay(true)
    socket.setKeepAlive(true, 30_000)
    const fail = (error) => {
      try { socket.destroy() } catch {}
      client.emit('error', error)
      client.emit('end', error.message)
    }
    socket.once('connect', async () => {
      socket.off('error', fail)
      try {
        log(`Proxy ${proxy.type} ${proxy.host}:${proxy.port} → ${targetHost}:${targetPort}`)
        if (proxy.type === 'HTTP') await httpHandshake(socket, targetHost, targetPort, proxy, timeoutMs)
        else await socksHandshake(socket, targetHost, targetPort, proxy, timeoutMs)
        client.setSocket(socket)
        client.emit('connect')
      } catch (error) {
        fail(error)
      }
    })
    socket.once('error', fail)
  }
}

module.exports = { createProxyConnect, validateProxy, httpHandshake, socksHandshake }
