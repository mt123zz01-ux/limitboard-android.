const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('zcore', {
  listProfiles: () => ipcRenderer.invoke('zcore:profiles:list'),
  createProfile: (profile) => ipcRenderer.invoke('zcore:profiles:create', profile),
  duplicateProfile: (id) => ipcRenderer.invoke('zcore:profiles:duplicate', id),
  updateProfile: (id, patch) => ipcRenderer.invoke('zcore:profiles:update', id, patch),
  deleteProfile: (id) => ipcRenderer.invoke('zcore:profiles:delete', id),
  startBot: (id) => ipcRenderer.invoke('zcore:bot:start', id),
  stopBot: (id) => ipcRenderer.invoke('zcore:bot:stop', id),
  resetStats: (id) => ipcRenderer.invoke('zcore:bot:reset-stats', id),
  sendChat: (id, text) => ipcRenderer.invoke('zcore:bot:chat', id, text),
  openLogs: () => ipcRenderer.invoke('zcore:logs:open'),
  enterHeadless: () => ipcRenderer.invoke('zcore:ui:headless'),
  openExternal: (url) => ipcRenderer.invoke('zcore:open-external', url),
  onProfilesChanged: (callback) => ipcRenderer.on('zcore:profiles-changed', (_event, value) => callback(value)),
  onBotEvent: (callback) => ipcRenderer.on('zcore:bot-event', (_event, value) => callback(value)),
  onAutoHeadless: (callback) => ipcRenderer.on('zcore:auto-headless', (_event, value) => callback(value))
})
