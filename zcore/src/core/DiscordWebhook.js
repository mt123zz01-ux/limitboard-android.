function isDiscordWebhook(url) {
  try {
    const parsed = new URL(url)
    const hosts = new Set(['discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com'])
    return parsed.protocol === 'https:' && hosts.has(parsed.hostname) && parsed.pathname.startsWith('/api/webhooks/')
  } catch {
    return false
  }
}

async function postWebhook(url, payload) {
  if (!isDiscordWebhook(url)) throw new Error('Discord Webhook URL không hợp lệ')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`Webhook trả về HTTP ${response.status}`)
}

function statsPayload(profile, username, stats, isFinal = false) {
  const elapsedSeconds = Math.floor(stats.elapsedMs / 1000)
  const h = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0')
  const s = String(elapsedSeconds % 60).padStart(2, '0')
  return {
    embeds: [{
      title: isFinal ? 'ZCore — Đã dừng phiên treo' : 'ZCore — Báo cáo treo máy',
      color: isFinal ? 0xef4444 : 0x22c55e,
      fields: [
        { name: 'Người chơi', value: username || 'Unknown', inline: true },
        { name: 'Server', value: `${profile.host}:${profile.port}`, inline: true },
        { name: 'Thời gian treo', value: `${h}:${m}:${s}`, inline: true },
        { name: 'Tổng thu nhập', value: StatsTracker.formatCurrency(stats.totalEarned), inline: true },
        { name: 'Trung bình', value: `${StatsTracker.formatCurrency(stats.earnedPerHour)}/h`, inline: true },
        { name: 'Lượt bán', value: String(stats.totalSalesCount), inline: true }
      ],
      footer: { text: 'ZCore • Minecraft 1.21.11' },
      timestamp: new Date().toISOString()
    }]
  }
}

function mentionEnvelope(profile) {
  const userId = String(profile?.discordMentionUserId || '').replace(/\D/g, '')
  if (!userId) return {}
  return {
    content: `<@${userId}>`,
    allowed_mentions: { parse: [], users: [userId] }
  }
}

function alertPayload(profile, username, type, details = {}) {
  const definitions = {
    death: {
      title: 'ZCore — Nhân vật đã chết',
      color: 0xef4444,
      fields: []
    },
    stranger: {
      title: 'ZCore — Phát hiện người lạ',
      color: 0xf59e0b,
      fields: [
        { name: 'Người lạ', value: String(details.player || 'Unknown'), inline: true },
        { name: 'Khoảng cách', value: `${Number(details.distance || 0).toFixed(1)} block`, inline: true },
        { name: 'Xử lý', value: String(details.action || 'Chỉ thông báo'), inline: true },
        ...(details.position ? [{ name: 'Vị trí bot', value: String(details.position) }] : [])
      ]
    },
    'no-sell': {
      title: 'ZCore — Không có lượt bán',
      color: 0xf59e0b,
      fields: [
        { name: 'Thời gian', value: `${Number(details.minutes || 0)} phút`, inline: true },
        { name: 'Trạng thái', value: 'Bot vẫn ONLINE nhưng Auto Sell chưa hoàn tất lượt bán mới.', inline: false }
      ]
    },
    offline: {
      title: 'ZCore — Bot đã OFFLINE',
      color: 0xef4444,
      fields: [
        { name: 'Lý do', value: String(details.reason || 'Mất kết nối không xác định').slice(0, 1024) }
      ]
    }
  }
  const definition = definitions[type]
  if (!definition) throw new Error(`Loại cảnh báo không hợp lệ: ${type}`)
  return {
    ...mentionEnvelope(profile),
    embeds: [{
      title: definition.title,
      color: definition.color,
      fields: [
        { name: 'Profile', value: profile?.name || 'Unknown', inline: true },
        { name: 'Người chơi', value: username || 'Unknown', inline: true },
        { name: 'Server', value: `${profile?.host || 'Unknown'}:${profile?.port || 25565}`, inline: true },
        ...definition.fields
      ],
      footer: { text: 'ZCore • Minecraft 1.21.11' },
      timestamp: new Date().toISOString()
    }]
  }
}

const { StatsTracker } = require('./StatsTracker')
module.exports = { isDiscordWebhook, postWebhook, statsPayload, mentionEnvelope, alertPayload }
