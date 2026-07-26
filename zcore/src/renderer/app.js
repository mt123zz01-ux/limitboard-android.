const $ = (selector) => document.querySelector(selector)
const CONSOLE_CACHE_LIMIT = 100
const state = {
  profiles: [],
  selectedId: localStorage.getItem('zcore:selected'),
  logs: new Map(),
  consoleScrollTop: new Map(),
  consoleFollow: new Map(),
  renderedConsole: { profileId: null, signature: null },
  renderedProfileSignature: null,
  commandHistory: [],
  commandHistoryIndex: 0,
  authUrl: 'https://www.microsoft.com/link'
}

function current() {
  return state.profiles.find((entry) => entry.profile.id === state.selectedId) || state.profiles[0] || null
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]))
}

function statusLabel(status) {
  return ({ offline:'OFFLINE', online:'ONLINE', connecting:'ĐANG KẾT NỐI', authenticating:'ĐĂNG NHẬP', reconnecting:'RECONNECT', blocked:'BỊ CHẶN' })[status] || String(status).toUpperCase()
}

function autoSellStateInfo(value, paused = false) {
  if (paused) return { label: 'TẠM DỪNG', tone: 'warning' }
  const stateName = String(value || 'IDLE')
  const labels = {
    IDLE: 'ĐANG TẮT',
    CHECKING_INVENTORY: 'CHỜ CÓ VẬT PHẨM',
    SENDING_COMMAND: 'ĐANG GỬI /SELL',
    WAITING_GUI: 'CHỜ GUI 90 SLOT',
    MOVING_ITEMS: 'ĐANG QUICKALL',
    WAITING_AFTER_MOVE: 'CHỜ ĐÓNG GUI',
    CLOSING_GUI: 'ĐANG ĐÓNG GUI',
    WAITING_AFTER_SELL: 'ĐÃ HOÀN TẤT',
    ERROR_COOLDOWN: 'PHỤC HỒI SAU LỖI'
  }
  const tone = stateName === 'ERROR_COOLDOWN'
    ? 'error'
    : (stateName === 'WAITING_AFTER_SELL' ? 'success' : (stateName === 'IDLE' ? 'idle' : 'active'))
  return { label: labels[stateName] || stateName, tone }
}

function formatDuration(ms = 0) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = String(Math.floor(total / 3600)).padStart(2, '0')
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function formatCurrency(amount = 0) {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(2)}M`
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(2)}K`
  return `$${Math.round(amount)}`
}

function formatCurrentBalance(amount = 0) {
  const compact = (value) => value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
  if (amount >= 1e12) return `$${compact(amount / 1e12)}T`
  if (amount >= 1e9) return `$${compact(amount / 1e9)}B`
  if (amount >= 1e6) return `$${compact(amount / 1e6)}M`
  if (amount >= 1e3) return `$${compact(amount / 1e3)}K`
  return `$${Math.round(amount)}`
}

function formatAge(timestamp) {
  const time = Number(timestamp)
  if (!Number.isFinite(time) || time <= 0) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 5) return 'vừa xong'
  if (seconds < 60) return `${seconds} giây trước`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  return `${Math.floor(minutes / 60)} giờ trước`
}

function balanceStatusText(balance, profile, status) {
  if (profile.balanceTrackingEnabled === false) return 'Theo dõi số dư đã tắt hoàn toàn'
  const autoEnabled = profile.balanceCommandEnabled !== false
  if (status !== 'online') {
    const age = formatAge(balance?.updatedAt)
    return age ? `Số dư gần nhất — ${age}` : 'Bot chưa ONLINE'
  }
  if (balance?.requestPending) return 'Đang chờ server trả lời /balance…'
  if (balance?.lastRequestError) return `Không gửi được /balance: ${balance.lastRequestError}`
  if (balance?.requestTimedOut) return 'Server chưa trả lời /balance — sẽ tự thử lại'
  const age = formatAge(balance?.updatedAt)
  if (balance?.source === 'balance-command') return age ? `Đã cập nhật bằng /balance — ${age}` : 'Đã cập nhật bằng /balance'
  if (balance?.source) return `Số dư dự phòng từ ${balance.source}${age ? ` — ${age}` : ''}`
  return autoEnabled ? 'Đang chờ lần cập nhật /balance đầu tiên' : 'Tự cập nhật đang tắt — có thể bấm “Cập nhật ngay”'
}

function formatWorkerHealth(runtime, profile) {
  if (profile.workerEnabled === false) return 'MAIN DÙNG CHUNG'
  if (runtime.status === 'offline') return 'ĐÃ GIẢI PHÓNG'
  const health = runtime.workerHealth
  if (!Number.isFinite(health?.heapUsed)) return 'ĐANG KHỞI ĐỘNG'
  const heapMb = health.heapUsed / (1024 * 1024)
  const label = health.state === 'stalled' ? 'PHỤC HỒI' : (health.state === 'high' ? 'CAO' : 'ỔN ĐỊNH')
  return `${heapMb.toFixed(1)} MB — ${label}`
}

function autoHomeSummary(profile) {
  const homeNumber = Math.min(4, Math.max(1, Math.round(Number(profile?.autoHomeNumber) || 1)))
  const delayMinutes = Math.min(1440, Math.max(1, Number(profile?.autoHomeDelayMinutes) || 5))
  return `/home ${homeNumber} · ${delayMinutes} phút`
}

function updateGuidance(selected) {
  const total = state.profiles.length
  const online = state.profiles.filter(({ runtime }) => runtime.status === 'online').length
  const active = state.profiles.filter(({ runtime }) => ['online', 'connecting', 'authenticating', 'reconnecting'].includes(runtime.status)).length
  $('#profile-summary').textContent = `${online} / ${total} online`
  $('#headless-mode').disabled = online === 0

  if (!selected) {
    $('#next-step-number').textContent = '1'
    $('#next-step-number').className = 'step-number'
    $('#next-step-title').textContent = 'Tạo profile đầu tiên'
    $('#next-step-description').textContent = 'Nhấn “Thêm tài khoản”, điền thông tin bắt buộc rồi lưu profile.'
    return
  }

  const status = selected.runtime.status || 'offline'
  if (status === 'online') {
    $('#next-step-number').textContent = '✓'
    $('#next-step-number').className = 'step-number online'
    $('#next-step-title').textContent = active > 1 ? `${online}/${active} tài khoản đã ONLINE` : 'Bot đã ONLINE và đang hoạt động'
    $('#next-step-description').textContent = online === active
      ? 'Khi không cần xem console, bạn có thể bật Treo siêu nhẹ.'
      : 'Chờ các tài khoản còn lại ONLINE rồi mới bật Treo siêu nhẹ.'
    return
  }

  $('#next-step-number').textContent = '2'
  $('#next-step-number').className = 'step-number'
  if (status === 'authenticating') {
    $('#next-step-title').textContent = 'Hoàn tất đăng nhập Microsoft'
    $('#next-step-description').textContent = 'Nhập mã đang hiển thị, sau đó chờ trạng thái chuyển thành ONLINE.'
  } else if (status === 'connecting') {
    $('#next-step-title').textContent = 'Đang kết nối tới server…'
    $('#next-step-description').textContent = 'Giữ ZCore mở và theo dõi thông báo trong console.'
  } else if (status === 'reconnecting') {
    $('#next-step-title').textContent = 'Bot đang tự kết nối lại…'
    $('#next-step-description').textContent = 'Không cần nhấn Start thêm lần nữa. Hãy xem console nếu chờ quá lâu.'
  } else if (status === 'blocked') {
    $('#next-step-title').textContent = 'Bot đã dừng vì cơ chế bảo vệ'
    $('#next-step-description').textContent = 'Xem dòng lỗi cuối trong console, kiểm tra cài đặt rồi nhấn Bắt đầu.'
  } else {
    $('#next-step-title').textContent = 'Nhấn Bắt đầu để vào server'
    $('#next-step-description').textContent = 'Lần đầu, ZCore sẽ yêu cầu mã đăng nhập Microsoft.'
  }
}

function render(options = {}) {
  if (!state.selectedId && state.profiles.length) state.selectedId = state.profiles[0].profile.id
  const selected = current()
  if (options.profiles !== false) renderProfiles()
  if (!selected) return renderEmpty()
  const { profile, runtime } = selected
  $('#selected-profile-name').textContent = profile.name
  $('#server-host').textContent = profile.host
  $('#server-port').textContent = `: ${profile.port}`
  $('#toggle-autosell').checked = profile.autoSellEnabled
  $('#toggle-autosell-axe').checked = profile.autoSellAxeEnabled
  $('#toggle-autohome').checked = profile.autoHomeEnabled
  $('#autohome-summary').textContent = autoHomeSummary(profile)
  $('#toggle-webhook').checked = profile.discordWebhookEnabled
  const status = runtime.status || 'offline'
  $('#status-pill').className = `status-pill ${status}`
  $('#status-pill').innerHTML = `<span></span>${statusLabel(status)}`
  $('#player-status').className = `mini-status ${status}`
  $('#player-status').textContent = `● ${statusLabel(status)}`
  $('#player-name').textContent = runtime.username || profile.microsoftAccount || 'Chưa đăng nhập'
  $('#player-initial').textContent = String(runtime.username || profile.name || '?').slice(0, 2).toUpperCase()
  $('#start-bot').disabled = ['online','connecting','authenticating','reconnecting'].includes(status)
  $('#stop-bot').disabled = status === 'offline'
  $('#reset-stats').disabled = false
  $('#edit-profile').disabled = false
  $('#duplicate-profile').disabled = false
  $('#toggle-autosell').disabled = false
  $('#toggle-autosell-axe').disabled = false
  $('#toggle-autohome').disabled = false
  $('#toggle-webhook').disabled = false
  $('#command-input').disabled = status !== 'online'
  $('#command-send').disabled = status !== 'online'
  $('#refresh-balance').disabled = (
    status !== 'online' ||
    profile.balanceTrackingEnabled === false ||
    runtime.balance?.requestPending === true
  )
  $('#refresh-balance').textContent = runtime.balance?.requestPending ? 'Đang chờ…' : 'Cập nhật ngay'
  $('#command-form').classList.toggle('offline', status !== 'online')
  $('#uptime').textContent = formatDuration(runtime.stats?.elapsedMs)
  $('#sales-count').textContent = runtime.stats?.totalSalesCount || 0
  $('#total-earned').textContent = formatCurrency(runtime.stats?.totalEarned)
  $('#earned-hour').textContent = `${formatCurrency(runtime.stats?.earnedPerHour)}/h`
  const balance = runtime.balance
  $('#current-balance').textContent = formatCurrentBalance(Number.isFinite(balance?.amount) ? balance.amount : 0)
  $('#current-balance-source').textContent = balanceStatusText(balance, profile, status)
  $('#coordinate-state').textContent = profile.coordinateProtectionEnabled ? 'BẬT' : 'TẮT'
  $('#guard-state').textContent = profile.whitelistGuardEnabled ? 'BẬT' : 'TẮT'
  if (profile.autoSellAxeEnabled) {
    const axeRunning = runtime.autoSellAxe?.running === true
    $('#autosell-state').textContent = axeRunning ? 'AXE · GIỮ CHUỘT TRÁI' : 'AXE · ĐANG CHỜ ONLINE'
    $('#autosell-state').className = `autosell-state-value ${axeRunning ? 'success' : 'warning'}`
    $('#autosell-state').title = profile.autoSellAxeLookUpEnabled
      ? 'AutoSellAxe Member · kiểm tra nhìn lên trời mỗi 5 phút'
      : 'AutoSellAxe Member · không tự chỉnh góc nhìn'
  } else {
    const autoSell = autoSellStateInfo(runtime.autoSellState, runtime.autoSellPaused)
    $('#autosell-state').textContent = autoSell.label
    $('#autosell-state').className = `autosell-state-value ${autoSell.tone}`
    $('#autosell-state').title = runtime.autoSellState || 'IDLE'
  }
  $('#autohome-state').textContent = profile.autoHomeEnabled
    ? `BẬT — HOME ${profile.autoHomeNumber} / ${profile.autoHomeDelayMinutes} PHÚT`
    : 'ĐANG TẮT'
  $('#engine-state').textContent = profile.clientEngine === 'mineflayer' ? 'MINEFLAYER' : 'PROTOCOL MAX'
  $('#worker-state').textContent = profile.workerEnabled === false ? 'TẮT — MAIN' : 'BẬT — WORKER RIÊNG'
  $('#afk-lite-state').textContent = profile.afkLiteEnabled === false ? 'TẮT' : 'BẬT — 2 CHUNK'
  $('#balance-command-state').textContent = profile.balanceTrackingEnabled === false
    ? 'TẮT HOÀN TOÀN'
    : (profile.balanceCommandEnabled === false ? 'BẬT — SCOREBOARD' : 'BẬT — /BALANCE')
  $('#worker-health-state').textContent = formatWorkerHealth(runtime, profile)
  updateGuidance(selected)
  if (options.logs !== false) renderLogs(profile.id, runtime.logs || [])
}

function profileListSignature() {
  return `${state.selectedId}${state.profiles.map(({ profile, runtime }) => [
    profile.id, profile.name, profile.host, profile.port, runtime.status || 'offline'
  ].join('')).join('')}`
}

function renderProfiles() {
  const online = state.profiles.filter(({ runtime }) => runtime.status === 'online').length
  $('#profile-summary').textContent = `${online} / ${state.profiles.length} online`
  // Repair 22 — render() chạy theo mỗi state event (mặc định 5 giây/account).
  // Dựng lại innerHTML cả danh sách mỗi lần là phần việc DOM tốn nhất của
  // renderer; bỏ qua khi không có gì đổi.
  const signature = profileListSignature()
  if (state.renderedProfileSignature === signature) return
  state.renderedProfileSignature = signature
  $('#profile-list').innerHTML = state.profiles.length ? state.profiles.map(({ profile, runtime }) => `
    <button class="profile-item ${profile.id === state.selectedId ? 'selected' : ''}" data-profile-id="${escapeHtml(profile.id)}">
      <span class="profile-avatar">${escapeHtml(profile.name.slice(0, 2).toUpperCase())}</span>
      <span class="profile-copy"><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.host)}:${profile.port}</small></span>
      <span class="profile-dot ${escapeHtml(runtime.status || 'offline')}"></span>
    </button>`).join('') : '<div class="empty-profile-list"><b>Chưa có tài khoản</b><span>Nhấn “Thêm tài khoản” ở phía trên để bắt đầu.</span></div>'
}

function renderEmpty() {
  $('#selected-profile-name').textContent = 'Chưa có tài khoản'
  $('#server-host').textContent = 'Hãy tạo Profile'
  $('#server-port').textContent = ''
  $('#start-bot').disabled = $('#stop-bot').disabled = $('#reset-stats').disabled = true
  $('#refresh-balance').disabled = true
  $('#refresh-balance').textContent = 'Cập nhật ngay'
  $('#headless-mode').disabled = true
  $('#edit-profile').disabled = true
  $('#duplicate-profile').disabled = true
  $('#toggle-autosell').disabled = $('#toggle-autosell-axe').disabled = $('#toggle-autohome').disabled = $('#toggle-webhook').disabled = true
  $('#toggle-autosell').checked = $('#toggle-autosell-axe').checked = $('#toggle-autohome').checked = $('#toggle-webhook').checked = false
  $('#autohome-summary').textContent = '/home 1 mỗi 5 phút'
  $('#status-pill').className = 'status-pill offline'
  $('#status-pill').innerHTML = '<span></span>OFFLINE'
  $('#player-name').textContent = 'Chưa đăng nhập'
  $('#player-initial').textContent = '?'
  $('#player-status').className = 'mini-status offline'
  $('#player-status').textContent = '● OFFLINE'
  $('#engine-state').textContent = 'PROTOCOL MAX'
  $('#autosell-state').textContent = 'ĐANG TẮT'
  $('#autosell-state').className = 'autosell-state-value idle'
  $('#autosell-state').title = 'IDLE'
  $('#autohome-state').textContent = 'ĐANG TẮT'
  updateGuidance(null)
}

function renderLogs(profileId, fallback) {
  const logs = (state.logs.has(profileId) ? state.logs.get(profileId) : fallback || []).slice(-CONSOLE_CACHE_LIMIT)
  state.logs.set(profileId, logs)
  const output = $('#terminal-output')
  const last = logs.at(-1)
  const signature = `${logs.length}:${last?.time || ''}:${last?.level || ''}:${last?.message || ''}`
  if (state.renderedConsole.profileId === profileId && state.renderedConsole.signature === signature) return

  const follow = state.consoleFollow.get(profileId) ?? true
  const previousScrollTop = state.renderedConsole.profileId === profileId
    ? output.scrollTop
    : (state.consoleScrollTop.get(profileId) || 0)
  state.renderedConsole = { profileId, signature }
  if (!logs.length) {
    output.innerHTML = '<div class="empty-console">Chưa có hoạt động. Hãy chọn profile và nhấn “Bắt đầu”.</div>'
    output.scrollTop = 0
    return
  }
  output.innerHTML = logs.map((log) => {
    const time = new Date(log.time).toLocaleTimeString('vi-VN', { hour12: false })
    return `<div class="log-line ${escapeHtml(log.level)}"><span class="log-time">${time}</span><span class="log-level">${escapeHtml(log.level)}</span><span>${escapeHtml(log.message)}</span></div>`
  }).join('')
  if (follow) output.scrollTop = output.scrollHeight
  else output.scrollTop = previousScrollTop
}

function createLogElement(log) {
  const row = document.createElement('div')
  row.className = `log-line ${String(log.level || 'info').replace(/[^a-z0-9_-]/gi, '')}`
  const time = document.createElement('span')
  time.className = 'log-time'
  time.textContent = new Date(log.time).toLocaleTimeString('vi-VN', { hour12: false })
  const level = document.createElement('span')
  level.className = 'log-level'
  level.textContent = log.level || 'info'
  const message = document.createElement('span')
  message.textContent = log.message || ''
  row.append(time, level, message)
  return row
}

function appendRenderedLogs(profileId, entries) {
  if (profileId !== state.selectedId || state.renderedConsole.profileId !== profileId || !entries.length) return
  const output = $('#terminal-output')
  const follow = state.consoleFollow.get(profileId) ?? true
  output.querySelector('.empty-console')?.remove()
  const fragment = document.createDocumentFragment()
  for (const entry of entries) fragment.append(createLogElement(entry))
  output.append(fragment)
  const expected = state.logs.get(profileId)?.length || 0
  while (output.childElementCount > expected) output.firstElementChild?.remove()
  const logs = state.logs.get(profileId) || []
  const last = logs.at(-1)
  state.renderedConsole.signature = `${logs.length}:${last?.time || ''}:${last?.level || ''}:${last?.message || ''}`
  if (follow) output.scrollTop = output.scrollHeight
}

function updateProfileStatus(profileId, status) {
  const item = [...document.querySelectorAll('[data-profile-id]')].find((node) => node.dataset.profileId === profileId)
  const dot = item?.querySelector('.profile-dot')
  if (dot) dot.className = `profile-dot ${String(status || 'offline').replace(/[^a-z-]/gi, '')}`
}

function scrollConsoleToBottom() {
  const output = $('#terminal-output')
  output.scrollTop = output.scrollHeight
  const item = current()
  if (item) {
    state.consoleFollow.set(item.profile.id, true)
    state.consoleScrollTop.set(item.profile.id, output.scrollTop)
  }
}

function toast(message, error = false) {
  const item = document.createElement('div')
  item.className = `toast${error ? ' error' : ''}`
  item.textContent = message
  $('#toast-container').append(item)
  setTimeout(() => item.remove(), 4200)
}

async function run(action) {
  try { return await action() } catch (error) { toast(error.message || String(error), true); return null }
}

function openProfileDialog(profile = null) {
  $('#profile-id').value = profile?.id || ''
  $('#profile-dialog-title').textContent = profile ? 'Chỉnh sửa Profile' : 'Tạo Profile'
  $('#profile-name').value = profile?.name || ''
  $('#profile-account').value = profile?.microsoftAccount || ''
  $('#profile-host').value = profile?.host || ''
  $('#profile-port').value = profile?.port || 25565
  $('#profile-auto-sell').checked = profile?.autoSellEnabled ?? true
  $('#profile-auto-sell-axe').checked = profile?.autoSellAxeEnabled ?? false
  $('#profile-auto-sell-axe-look-up').checked = profile?.autoSellAxeLookUpEnabled ?? true
  $('#profile-auto-sell-delay').value = profile?.autoSellDelaySeconds ?? 0.2
  $('#profile-auto-sell-random').checked = profile?.autoSellRandomDelayEnabled ?? true
  $('#profile-auto-sell-delay-min').value = profile?.autoSellDelayMinSeconds ?? 0.15
  $('#profile-auto-sell-delay-max').value = profile?.autoSellDelayMaxSeconds ?? 0.3
  $('#profile-auto-sell-check-delay-min').value = profile?.autoSellInventoryCheckDelayMinSeconds ?? 0.1
  $('#profile-auto-sell-check-delay-max').value = profile?.autoSellInventoryCheckDelayMaxSeconds ?? 0.2
  $('#profile-auto-sell-quick-delay-min').value = profile?.autoSellQuickAllDelayMinSeconds ?? 0.05
  $('#profile-auto-sell-quick-delay-max').value = profile?.autoSellQuickAllDelayMaxSeconds ?? 0.1
  $('#profile-auto-sell-move-delay-min').value = profile?.autoSellMoveDelayMinSeconds ?? 0.25
  $('#profile-auto-sell-move-delay-max').value = profile?.autoSellMoveDelayMaxSeconds ?? 0.4
  $('#profile-auto-sell-gui-timeout').value = profile?.autoSellGuiTimeoutSeconds ?? 3
  $('#profile-auto-sell-error-cooldown').value = profile?.autoSellErrorCooldownSeconds ?? 1
  $('#profile-auto-sell-tick-ms').value = profile?.autoSellTickMilliseconds ?? 50
  $('#profile-auto-home').checked = profile?.autoHomeEnabled ?? false
  $('#profile-auto-home-number').value = profile?.autoHomeNumber ?? 1
  $('#profile-auto-home-delay').value = profile?.autoHomeDelayMinutes ?? 5
  $('#profile-console').checked = profile?.consoleEnabled ?? true
  $('#profile-stats').checked = profile?.statsEnabled ?? true
  $('#profile-reconnect').checked = profile?.autoReconnectEnabled ?? true
  $('#profile-client-engine').value = profile?.clientEngine === 'mineflayer' ? 'mineflayer' : 'protocol'
  $('#profile-worker').checked = profile?.workerEnabled ?? true
  $('#profile-afk-lite').checked = profile?.afkLiteEnabled ?? true
  $('#profile-balance-tracking').checked = profile?.balanceTrackingEnabled ?? true
  $('#profile-balance-command').checked = profile?.balanceCommandEnabled ?? true
  $('#profile-reconnect-delay').value = profile?.reconnectDelaySeconds || 10
  $('#profile-webhook-enabled').checked = profile?.discordWebhookEnabled ?? false
  $('#profile-webhook-url').value = profile?.discordWebhookUrl || ''
  $('#profile-webhook-user-id').value = profile?.discordMentionUserId || ''
  $('#profile-webhook-report').checked = profile?.webhookPeriodicReportEnabled ?? true
  $('#profile-webhook-death').checked = profile?.webhookDeathAlertEnabled ?? false
  $('#profile-webhook-stranger').checked = profile?.webhookStrangerAlertEnabled ?? false
  $('#profile-webhook-no-sell').checked = profile?.webhookNoSellAlertEnabled ?? false
  $('#profile-webhook-no-sell-minutes').value = profile?.webhookNoSellMinutes || 5
  $('#profile-webhook-offline').checked = profile?.webhookOfflineAlertEnabled ?? false
  $('#profile-webhook-interval').value = profile?.discordWebhookIntervalMinutes || 60
  $('#profile-coordinate').checked = profile?.coordinateProtectionEnabled ?? false
  $('#profile-guard').checked = profile?.whitelistGuardEnabled ?? false
  $('#profile-threshold').value = profile?.positionThreshold || 1
  $('#profile-radius').value = profile?.whitelistScanRadius || 32
  $('#profile-stranger-action').value = profile?.strangerAction || 'notify'
  $('#profile-whitelist').value = (profile?.whitelistedPlayers || []).join(', ')
  $('#profile-proxy-enabled').checked = profile?.proxyEnabled ?? false
  $('#profile-proxy-type').value = profile?.proxyType || 'SOCKS5'
  $('#profile-proxy-host').value = profile?.proxyHost || ''
  $('#profile-proxy-port').value = profile?.proxyPort || 1080
  $('#profile-proxy-username').value = profile?.proxyUsername || ''
  $('#profile-proxy-password').value = profile?.proxyPassword || ''
  $('#delete-profile').style.visibility = profile ? 'visible' : 'hidden'
  syncAutoSellDelayControls()
  syncAutoSellModes()
  syncAutoHomeControls()
  syncBalanceControls()
  $('#profile-dialog').showModal()
}

function syncAutoSellDelayControls() {
  const randomEnabled = $('#profile-auto-sell-random').checked
  $('#profile-auto-sell-delay').disabled = randomEnabled
  $('#profile-auto-sell-delay-min').disabled = !randomEnabled
  $('#profile-auto-sell-delay-max').disabled = !randomEnabled
}

function syncAutoSellModes(changedMode = '') {
  const autoSell = $('#profile-auto-sell')
  const autoSellAxe = $('#profile-auto-sell-axe')
  if (changedMode === 'sell' && autoSell.checked) autoSellAxe.checked = false
  if (changedMode === 'axe' && autoSellAxe.checked) autoSell.checked = false
  if (autoSell.checked && autoSellAxe.checked) autoSell.checked = false
  $('#profile-auto-sell-axe-look-up').disabled = !autoSellAxe.checked
}

function syncAutoHomeControls() {
  const enabled = $('#profile-auto-home').checked
  $('#profile-auto-home-number').disabled = !enabled
  $('#profile-auto-home-delay').disabled = !enabled
}

function syncBalanceControls() {
  $('#profile-balance-command').disabled = !$('#profile-balance-tracking').checked
}

function readProfileForm() {
  return {
    name: $('#profile-name').value,
    microsoftAccount: $('#profile-account').value,
    host: $('#profile-host').value,
    port: Number($('#profile-port').value),
    autoSellEnabled: $('#profile-auto-sell').checked && !$('#profile-auto-sell-axe').checked,
    autoSellAxeEnabled: $('#profile-auto-sell-axe').checked,
    autoSellAxeLookUpEnabled: $('#profile-auto-sell-axe-look-up').checked,
    autoSellDelaySeconds: Number($('#profile-auto-sell-delay').value),
    autoSellRandomDelayEnabled: $('#profile-auto-sell-random').checked,
    autoSellDelayMinSeconds: Number($('#profile-auto-sell-delay-min').value),
    autoSellDelayMaxSeconds: Number($('#profile-auto-sell-delay-max').value),
    autoSellInventoryCheckDelayMinSeconds: Number($('#profile-auto-sell-check-delay-min').value),
    autoSellInventoryCheckDelayMaxSeconds: Number($('#profile-auto-sell-check-delay-max').value),
    autoSellQuickAllDelayMinSeconds: Number($('#profile-auto-sell-quick-delay-min').value),
    autoSellQuickAllDelayMaxSeconds: Number($('#profile-auto-sell-quick-delay-max').value),
    autoSellMoveDelayMinSeconds: Number($('#profile-auto-sell-move-delay-min').value),
    autoSellMoveDelayMaxSeconds: Number($('#profile-auto-sell-move-delay-max').value),
    autoSellGuiTimeoutSeconds: Number($('#profile-auto-sell-gui-timeout').value),
    autoSellErrorCooldownSeconds: Number($('#profile-auto-sell-error-cooldown').value),
    autoSellTickMilliseconds: Number($('#profile-auto-sell-tick-ms').value),
    autoHomeEnabled: $('#profile-auto-home').checked,
    autoHomeNumber: Number($('#profile-auto-home-number').value),
    autoHomeDelayMinutes: Number($('#profile-auto-home-delay').value),
    consoleEnabled: $('#profile-console').checked,
    statsEnabled: $('#profile-stats').checked,
    autoReconnectEnabled: $('#profile-reconnect').checked,
    clientEngine: $('#profile-client-engine').value,
    workerEnabled: $('#profile-worker').checked,
    afkLiteEnabled: $('#profile-afk-lite').checked,
    balanceTrackingEnabled: $('#profile-balance-tracking').checked,
    balanceCommandEnabled: $('#profile-balance-command').checked,
    reconnectDelaySeconds: Number($('#profile-reconnect-delay').value),
    discordWebhookEnabled: $('#profile-webhook-enabled').checked,
    discordWebhookUrl: $('#profile-webhook-url').value,
    discordMentionUserId: $('#profile-webhook-user-id').value,
    webhookPeriodicReportEnabled: $('#profile-webhook-report').checked,
    webhookDeathAlertEnabled: $('#profile-webhook-death').checked,
    webhookStrangerAlertEnabled: $('#profile-webhook-stranger').checked,
    webhookNoSellAlertEnabled: $('#profile-webhook-no-sell').checked,
    webhookNoSellMinutes: Number($('#profile-webhook-no-sell-minutes').value),
    webhookOfflineAlertEnabled: $('#profile-webhook-offline').checked,
    discordWebhookIntervalMinutes: Number($('#profile-webhook-interval').value),
    coordinateProtectionEnabled: $('#profile-coordinate').checked,
    positionThreshold: Number($('#profile-threshold').value),
    whitelistGuardEnabled: $('#profile-guard').checked,
    whitelistScanRadius: Number($('#profile-radius').value),
    strangerAction: $('#profile-stranger-action').value,
    whitelistedPlayers: $('#profile-whitelist').value.split(',').map((v) => v.trim()).filter(Boolean),
    proxyEnabled: $('#profile-proxy-enabled').checked,
    proxyType: $('#profile-proxy-type').value,
    proxyHost: $('#profile-proxy-host').value,
    proxyPort: Number($('#profile-proxy-port').value),
    proxyUsername: $('#profile-proxy-username').value,
    proxyPassword: $('#profile-proxy-password').value
  }
}

$('#new-profile').addEventListener('click', () => openProfileDialog())
$('#edit-profile').addEventListener('click', () => { const item = current(); if (item) openProfileDialog(item.profile) })
$('#duplicate-profile').addEventListener('click', async () => {
  const item = current()
  if (!item) return
  const profile = await run(() => window.zcore.duplicateProfile(item.profile.id))
  if (!profile) return
  state.selectedId = profile.id
  localStorage.setItem('zcore:selected', profile.id)
  state.profiles = await window.zcore.listProfiles()
  render()
  openProfileDialog(profile)
  toast('Đã sao chép toàn bộ cài đặt. Hãy nhập email Microsoft cho tài khoản mới.')
})
$('#profile-auto-sell-random').addEventListener('change', syncAutoSellDelayControls)
$('#profile-auto-sell').addEventListener('change', () => syncAutoSellModes('sell'))
$('#profile-auto-sell-axe').addEventListener('change', () => syncAutoSellModes('axe'))
$('#profile-auto-home').addEventListener('change', syncAutoHomeControls)
$('#profile-balance-tracking').addEventListener('change', syncBalanceControls)
$('#refresh-balance').addEventListener('click', async () => {
  const item = current()
  if (!item || item.runtime.status !== 'online') return
  const sent = await run(() => window.zcore.sendChat(item.profile.id, '/balance'))
  if (sent) toast('Đã gửi /balance, đang chờ server phản hồi.')
})
$('#open-help').addEventListener('click', () => $('#help-dialog').showModal())
$('#open-help-sidebar').addEventListener('click', () => $('#help-dialog').showModal())
$('#profile-list').addEventListener('click', (event) => {
  const item = event.target.closest('[data-profile-id]')
  if (!item) return
  state.selectedId = item.dataset.profileId
  localStorage.setItem('zcore:selected', state.selectedId)
  render()
})

document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()))

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const id = $('#profile-id').value
  let profile
  try {
    profile = readProfileForm()
  } catch (error) {
    toast(error.message || String(error), true)
    return
  }
  const result = await run(() => id ? window.zcore.updateProfile(id, profile) : window.zcore.createProfile(profile))
  if (!result) return
  if (!id) state.selectedId = result.id
  $('#profile-dialog').close()
  state.profiles = await window.zcore.listProfiles()
  render()
})

$('#delete-profile').addEventListener('click', async () => {
  const id = $('#profile-id').value
  if (!id || !confirm('Xóa profile và token Microsoft đã cache trên máy này?')) return
  await run(() => window.zcore.deleteProfile(id))
  state.selectedId = null
  $('#profile-dialog').close()
  state.profiles = await window.zcore.listProfiles()
  render()
})

$('#start-bot').addEventListener('click', () => { const item = current(); if (item) run(() => window.zcore.startBot(item.profile.id)) })
$('#stop-bot').addEventListener('click', () => { const item = current(); if (item) run(() => window.zcore.stopBot(item.profile.id)) })
$('#reset-stats').addEventListener('click', () => { const item = current(); if (item && confirm('Đặt lại số lượt bán và tiền kiếm trong phiên?')) run(() => window.zcore.resetStats(item.profile.id)) })

$('#toggle-autosell').addEventListener('change', (event) => {
  const item = current()
  if (!item) return
  if (event.target.checked) $('#toggle-autosell-axe').checked = false
  run(() => window.zcore.updateProfile(item.profile.id, {
    autoSellEnabled: event.target.checked,
    ...(event.target.checked ? { autoSellAxeEnabled: false } : {})
  }))
})
$('#toggle-autosell-axe').addEventListener('change', (event) => {
  const item = current()
  if (!item) return
  if (event.target.checked) $('#toggle-autosell').checked = false
  run(() => window.zcore.updateProfile(item.profile.id, {
    autoSellAxeEnabled: event.target.checked,
    ...(event.target.checked ? { autoSellEnabled: false } : {})
  }))
})
$('#toggle-autohome').addEventListener('change', (event) => { const item = current(); if (item) run(() => window.zcore.updateProfile(item.profile.id, { autoHomeEnabled: event.target.checked })) })
$('#toggle-webhook').addEventListener('change', (event) => {
  const item = current(); if (!item) return
  if (event.target.checked && !item.profile.discordWebhookUrl) { event.target.checked = false; openProfileDialog(item.profile); toast('Hãy nhập Discord Webhook URL trước.'); return }
  run(() => window.zcore.updateProfile(item.profile.id, { discordWebhookEnabled: event.target.checked }))
})

$('#command-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const item = current(); const input = $('#command-input')
  const value = input.value.trim()
  if (!item || !value) return
  const sent = await run(() => window.zcore.sendChat(item.profile.id, value))
  if (sent !== null) {
    if (state.commandHistory.at(-1) !== value) state.commandHistory.push(value)
    state.commandHistory = state.commandHistory.slice(-50)
    state.commandHistoryIndex = state.commandHistory.length
    input.value = ''
    input.focus()
  }
})

$('#command-input').addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !state.commandHistory.length) return
  event.preventDefault()
  if (event.key === 'ArrowUp') state.commandHistoryIndex = Math.max(0, state.commandHistoryIndex - 1)
  else state.commandHistoryIndex = Math.min(state.commandHistory.length, state.commandHistoryIndex + 1)
  $('#command-input').value = state.commandHistory[state.commandHistoryIndex] || ''
})

$('#terminal-output').addEventListener('scroll', () => {
  const item = current()
  if (!item) return
  const output = $('#terminal-output')
  const nearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40
  state.consoleFollow.set(item.profile.id, nearBottom)
  state.consoleScrollTop.set(item.profile.id, output.scrollTop)
})

$('#clear-console').addEventListener('click', () => { const item = current(); if (!item) return; state.logs.set(item.profile.id, []); renderLogs(item.profile.id, []) })
$('#open-logs').addEventListener('click', () => run(() => window.zcore.openLogs()))
$('#headless-mode').addEventListener('click', () => {
  const online = state.profiles.filter(({ runtime }) => runtime.status === 'online').length
  const waiting = state.profiles.filter(({ runtime }) => ['connecting', 'authenticating', 'reconnecting'].includes(runtime.status)).length
  const warning = waiting
    ? `Hiện có ${online} acc ONLINE và ${waiting} acc vẫn đang kết nối. Nên chờ tất cả ONLINE trước khi ẩn giao diện.\n\nBạn vẫn muốn Treo siêu nhẹ ngay?`
    : `Ẩn giao diện để giảm RAM/CPU? ${online} acc ONLINE vẫn tiếp tục chạy.\n\nNhấp đúp biểu tượng ZCore ở khay hệ thống để mở lại.`
  if (!confirm(warning)) return
  run(() => window.zcore.enterHeadless())
})
$('#scroll-console-bottom').addEventListener('click', scrollConsoleToBottom)
$('#open-microsoft').addEventListener('click', () => run(() => window.zcore.openExternal(state.authUrl)))

window.zcore.onProfilesChanged((profiles) => {
  state.profiles = profiles
  for (const entry of profiles) {
    if (entry.runtime?.logs?.length && !state.logs.has(entry.profile.id)) state.logs.set(entry.profile.id, entry.runtime.logs)
  }
  render()
})

window.zcore.onBotEvent((event) => {
  if (event.type === 'log' || event.type === 'log-batch') {
    const entries = event.type === 'log-batch' ? event.payload : [event.payload]
    const logs = state.logs.get(event.profileId) || []
    logs.push(...entries)
    if (logs.length > CONSOLE_CACHE_LIMIT) logs.splice(0, logs.length - CONSOLE_CACHE_LIMIT)
    state.logs.set(event.profileId, logs)
    appendRenderedLogs(event.profileId, entries)
  }
  if (event.type === 'state') {
    const entry = state.profiles.find((value) => value.profile.id === event.profileId)
    if (entry) entry.runtime = { ...entry.runtime, ...event.payload, logs: entry.runtime.logs || [] }
    updateProfileStatus(event.profileId, event.payload?.status)
    if (
      $('#auth-dialog').open &&
      state.profiles.length > 0 &&
      state.profiles.every(({ runtime }) => runtime.status === 'online')
    ) $('#auth-dialog').close()
    if (event.profileId === state.selectedId) render({ profiles: false, logs: false })
  }
  if (event.type === 'auth-code') {
    state.authUrl = event.payload.verificationUri || 'https://www.microsoft.com/link'
    $('#auth-code').textContent = event.payload.userCode || 'XEM CONSOLE'
    $('#auth-message').textContent = event.payload.message || 'Sau khi xác thực, ZCore sẽ tự tiếp tục kết nối.'
    if (!$('#auth-dialog').open) $('#auth-dialog').showModal()
  }
})

window.zcore.onAutoHeadless(({ delayMs }) => {
  toast(`Tất cả tài khoản đã ONLINE. ZCore sẽ tự chuyển sang Treo siêu nhẹ sau ${Math.round(delayMs / 1000)} giây.`)
})

;(async () => {
  state.profiles = await run(() => window.zcore.listProfiles()) || []
  if (!state.profiles.some((entry) => entry.profile.id === state.selectedId)) state.selectedId = state.profiles[0]?.profile.id || null
  render()
  if (!state.profiles.length && !localStorage.getItem('zcore:help-seen-r14')) {
    localStorage.setItem('zcore:help-seen-r14', '1')
    $('#help-dialog').showModal()
  }
})()
