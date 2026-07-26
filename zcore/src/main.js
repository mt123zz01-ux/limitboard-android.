const path = require('node:path')
const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron')
const { ProfileStore } = require('./core/ProfileStore')
const { BotManager } = require('./core/BotManager')
const { isDiscordWebhook } = require('./core/DiscordWebhook')
const { validateProxy } = require('./core/ProxyConnector')

let mainWindow
let manager
let tray
let headlessMode = false
let isQuitting = false
let autoHeadlessTimer = null
let allProfilesWereOnline = false

const AUTO_HEADLESS_DELAY_MS = 15_000

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.exit(0)
  return
}

// Repair 22 — giao diện ZCore chỉ là DOM tĩnh: không canvas, không WebGL, không
// video. Bật tăng tốc phần cứng chỉ tạo thêm một GPU process và giữ texture
// trong VRAM mà không đổi lại được gì. Tắt hẳn để bỏ trọn một process.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')

process.on('uncaughtException', (error) => {
  console.error('[ZCore uncaughtException]', error)
  manager?.fileLogger?.write('system', 'error', 'Lỗi ứng dụng chưa được xử lý', error)
})

process.on('unhandledRejection', (error) => {
  console.error('[ZCore unhandledRejection]', error)
  manager?.fileLogger?.write('system', 'error', 'Promise bị từ chối chưa được xử lý', error)
})

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  headlessMode = false
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 950,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1120',
    title: 'ZCore — Minecraft Bot Client',
    show: false,
    autoHideMenuBar: true,
    paintWhenInitiallyHidden: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      // Giao diện không dùng các subsystem này; tắt để renderer không nạp chúng.
      spellcheck: false,
      webgl: false,
      enableWebSQL: false,
      v8CacheOptions: 'code'
    }
  })
  mainWindow.removeMenu()
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.once('closed', () => { mainWindow = null })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  return mainWindow
}

function destroyTray() {
  tray?.destroy()
  tray = null
}

function restoreWindow() {
  headlessMode = false
  manager?.setResourceSavingMode(false)
  destroyTray()
  const window = createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function clearAutoHeadlessTimer() {
  if (autoHeadlessTimer) clearTimeout(autoHeadlessTimer)
  autoHeadlessTimer = null
}

function allProfilesOnline() {
  const profiles = manager?.profileStore?.list?.() || []
  return profiles.length > 0 && profiles.every((profile) => (
    manager.runtimes.get(profile.id)?.status === 'online'
  ))
}

async function tryAutoHeadless() {
  autoHeadlessTimer = null
  if (headlessMode || isQuitting || !allProfilesOnline()) return
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  try {
    const dialogOpen = await window.webContents.executeJavaScript(
      'Boolean(document.querySelector("dialog[open]"))',
      true
    )
    if (dialogOpen) {
      autoHeadlessTimer = setTimeout(tryAutoHeadless, AUTO_HEADLESS_DELAY_MS)
      autoHeadlessTimer.unref?.()
      return
    }
  } catch {}
  await enterHeadlessMode()
}

function updateAutoHeadless(statusHint = null) {
  if (headlessMode || isQuitting || !manager) return
  if (statusHint === 'online' && (allProfilesWereOnline || autoHeadlessTimer)) return
  const allOnline = allProfilesOnline()
  if (!allOnline) {
    clearAutoHeadlessTimer()
    allProfilesWereOnline = false
    return
  }
  if (allProfilesWereOnline || autoHeadlessTimer) return
  allProfilesWereOnline = true
  send('zcore:auto-headless', { delayMs: AUTO_HEADLESS_DELAY_MS })
  autoHeadlessTimer = setTimeout(tryAutoHeadless, AUTO_HEADLESS_DELAY_MS)
  autoHeadlessTimer.unref?.()
}

function ensureTray() {
  if (tray) return
  const iconName = process.platform === 'win32' ? 'zcore.ico' : 'zcore.png'
  tray = new Tray(path.join(__dirname, '..', 'assets', iconName))
  tray.setToolTip('ZCore — AFK Max đang chạy nền')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở ZCore', click: restoreWindow },
    { type: 'separator' },
    { label: 'Dừng bot và thoát', click: () => { isQuitting = true; app.quit() } }
  ]))
  tray.on('double-click', restoreWindow)
}

async function enterHeadlessMode() {
  clearAutoHeadlessTimer()
  headlessMode = true
  ensureTray()
  await manager?.setResourceSavingMode(true)
  setImmediate(() => {
    const window = mainWindow
    mainWindow = null
    if (window && !window.isDestroyed()) window.destroy()
  })
}

function validateProfile(input) {
  if (!input || typeof input !== 'object') throw new Error('Dữ liệu profile không hợp lệ')
  const host = String(input.host || '').trim()
  if (!host || host.length > 255 || /[\s/\\]/.test(host)) throw new Error('Địa chỉ server không hợp lệ')
  const port = Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port phải nằm trong 1–65535')
  if (input.discordWebhookEnabled && !isDiscordWebhook(input.discordWebhookUrl)) {
    throw new Error('Discord Webhook URL không hợp lệ')
  }
  if (input.discordMentionUserId && !/^\d{5,32}$/.test(String(input.discordMentionUserId))) {
    throw new Error('Discord User ID chỉ được chứa chữ số')
  }
  if (input.proxyEnabled) validateProxy(input)
  return input
}

function mergeProfileModes(current, patch) {
  const next = { ...(current || {}), ...(patch || {}) }
  if (patch?.autoSellAxeEnabled === true) next.autoSellEnabled = false
  else if (patch?.autoSellEnabled === true) next.autoSellAxeEnabled = false
  if (next.autoSellEnabled === true && next.autoSellAxeEnabled === true) next.autoSellEnabled = false
  return next
}

function registerIpc() {
  ipcMain.handle('zcore:profiles:list', () => manager.list())
  ipcMain.handle('zcore:profiles:create', (_event, input) => manager.create(validateProfile(input)))
  ipcMain.handle('zcore:profiles:duplicate', (_event, id) => manager.duplicate(String(id)))
  ipcMain.handle('zcore:profiles:update', (_event, id, patch) => {
    const profileId = String(id)
    return manager.update(profileId, validateProfile(mergeProfileModes(manager.profileStore.get(profileId), patch)))
  })
  ipcMain.handle('zcore:profiles:delete', (_event, id) => manager.delete(String(id)))
  ipcMain.handle('zcore:bot:start', (_event, id) => manager.start(String(id)))
  ipcMain.handle('zcore:bot:stop', (_event, id) => manager.stop(String(id)))
  ipcMain.handle('zcore:bot:reset-stats', (_event, id) => manager.resetStats(String(id)))
  ipcMain.handle('zcore:bot:chat', (_event, id, text) => manager.sendChat(String(id), String(text)))
  ipcMain.handle('zcore:logs:open', async () => {
    const error = await shell.openPath(manager.logDirectory)
    if (error) throw new Error(error)
    return true
  })
  ipcMain.handle('zcore:ui:headless', async () => {
    await enterHeadlessMode()
    return true
  })
  ipcMain.handle('zcore:open-external', (_event, url) => {
    const parsed = new URL(String(url))
    const allowed = new Set(['microsoft.com', 'www.microsoft.com', 'microsoftonline.com', 'login.microsoftonline.com'])
    if (parsed.protocol !== 'https:' || !allowed.has(parsed.hostname)) throw new Error('Liên kết không được phép')
    return shell.openExternal(parsed.href)
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('dev.lowzii.zcore')
  const dataDirectory = path.join(app.getPath('userData'), 'data')
  const profileStore = new ProfileStore(dataDirectory)
  manager = new BotManager(profileStore, app.getPath('userData'), (type, payload) => {
    send(`zcore:${type}`, payload)
    if (type === 'profiles-changed' || (type === 'bot-event' && payload?.type === 'state')) {
      updateAutoHeadless(type === 'bot-event' ? payload?.payload?.status : null)
    }
  })
  registerIpc()
  createWindow()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) restoreWindow()
})

app.on('second-instance', () => {
  restoreWindow()
})

app.on('before-quit', () => {
  isQuitting = true
  headlessMode = false
  clearAutoHeadlessTimer()
  destroyTray()
  manager?.stopAll()
})

module.exports = {
  AUTO_HEADLESS_DELAY_MS,
  allProfilesOnline
}
app.on('window-all-closed', () => {
  if (!headlessMode && !isQuitting && process.platform !== 'darwin') app.quit()
})
