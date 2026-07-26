const { EventEmitter } = require('node:events')
const minecraftProtocol = require('minecraft-protocol')
const registryLoader = require('prismarine-registry')
const createChatMessage = require('prismarine-chat')
const { Vec3 } = require('vec3')
const { UltraLiteClient } = require('./UltraLiteClient')

const injectInventory = require('mineflayer/lib/plugins/inventory')
const injectSimpleInventory = require('mineflayer/lib/plugins/simple_inventory')

const VERSION = '1.21.11'
const MOVEMENT_INTERVAL_MS = 1_000
const CHAT_HISTORY_LIMIT = 64
const RESOURCE_PACK_RESULT = Object.freeze({
  SUCCESSFULLY_LOADED: 0,
  DECLINED: 1,
  FAILED_DOWNLOAD: 2,
  ACCEPTED: 3
})

function normalizeUuid(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.toLowerCase()
  if (Buffer.isBuffer(value)) return value.toString('hex').toLowerCase()
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return value.toString().toLowerCase()
  }
  return String(value).toLowerCase()
}

function gameModeName(value) {
  return ['survival', 'creative', 'adventure', 'spectator'][Number(value) & 3] || 'survival'
}

function safeChatText(ChatMessage, value) {
  if (value == null) return ''
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return ChatMessage.fromNotch(parsed).toString()
    } catch {
      return value
    }
  }
  try {
    return ChatMessage.fromNotch(value).toString()
  } catch {
    if (typeof value?.value === 'string') return value.value
    try { return JSON.stringify(value) } catch { return String(value) }
  }
}

function relativeValue(current, incoming, relative) {
  return relative ? current + incoming : incoming
}

function createProtocolBot(options = {}) {
  const version = options.version || VERSION
  const registry = registryLoader(version)
  if (!registry?.version) throw new Error(`Minecraft ${version} chưa được hỗ trợ`)

  const bot = new EventEmitter()
  const clientFactory = options.clientFactory || minecraftProtocol.createClient
  const client = clientFactory({
    ...options,
    version,
    ...(options.clientFactory ? {} : { Client: UltraLiteClient }),
    keepAlive: true,
    checkTimeoutInterval: Math.max(30_000, Number(options.checkTimeoutInterval) || 45_000)
  })
  const ChatMessage = createChatMessage(registry)
  client.configureUltraLite?.({
    scoreboardEnabled: options.balanceScoreboardEnabled === true,
    playerTrackingEnabled: options.playerTrackingEnabled === true
  })
  const uuidToPlayer = new Map()
  const entityIdToUuid = new Map()
  const pendingPlayerEntities = new Map()
  let spawned = false
  let movementTimer = null
  let ended = false

  bot._client = client
  bot.registry = registry
  bot.protocolVersion = registry.version.version
  bot.majorVersion = registry.version.majorVersion
  bot.version = registry.version.minecraftVersion
  bot.supportFeature = registry.supportFeature
  bot.username = options.username || null
  bot.players = Object.create(null)
  bot.game = { gameMode: 'survival', minY: -64, height: 384 }
  bot.entity = {
    id: 0,
    username: bot.username,
    type: registry.entitiesByName.player?.id,
    position: new Vec3(0, 0, 0),
    velocity: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    onGround: false,
    height: 1.8,
    eyeHeight: 1.62
  }
  bot.food = 20
  bot.isAlive = true
  bot.lastDigTime = null
  bot._warn = () => {}

  bot.end = (reason) => client.end(reason)
  bot.quit = (reason = 'disconnect.quitting') => client.end(reason)
  bot.chat = (message) => {
    if (typeof client.chat !== 'function') throw new Error('Chat chưa sẵn sàng')
    return client.chat(message)
  }
  bot.zcoreSwingLeft = () => {
    if (ended || client.state !== 'play') return false
    client.write('arm_animation', { hand: 0 })
    return true
  }
  bot.swingArm = () => bot.zcoreSwingLeft()
  bot.zcoreIsLookingStraightUp = () => Math.abs(Number(bot.entity.pitch) + 90) <= 1
  bot.zcoreLookStraightUp = () => {
    if (ended || client.state !== 'play') return false
    bot.entity.pitch = -90
    client.write('look', {
      yaw: Number(bot.entity.yaw) || 0,
      pitch: -90,
      flags: {
        onGround: bot.entity.onGround === true,
        hasHorizontalCollision: false
      }
    })
    return true
  }

  injectInventory(bot, { hideErrors: true })
  injectSimpleInventory(bot, {})
  const Item = require('prismarine-item')(registry)
  client.on('window_items', (packet) => {
    const window = packet.windowId === 0 ? bot.inventory : bot.currentWindow
    if (window && packet.carriedItem) window.selectedItem = Item.fromNotch(packet.carriedItem)
  })
  client.on('set_cursor_item', (packet) => {
    const window = bot.currentWindow || bot.inventory
    if (window) window.selectedItem = Item.fromNotch(packet.contents)
  })

  function emitMessage(value, position = 'system') {
    if (typeof bot.shouldProcessMessage === 'function' && !bot.shouldProcessMessage(position)) return
    const text = safeChatText(ChatMessage, value).trim()
    if (text) bot.emit('messagestr', text, position)
  }

  function writeSettings() {
    client.write('settings', {
      locale: 'vi_VN',
      viewDistance: Math.max(2, Number(options.viewDistance) || 2),
      chatFlags: 0,
      chatColors: options.colorsEnabled !== false,
      skinParts: 0x7f,
      mainHand: 1,
      enableTextFiltering: false,
      enableServerListing: true,
      particleStatus: 'minimal'
    })
  }

  function writeBrand() {
    try {
      client.registerChannel('minecraft:brand', ['string', []])
      client.writeChannel('minecraft:brand', 'vanilla')
    } catch {}
  }

  function sendCurrentPosition(includeLook = false) {
    if (ended || client.state !== 'play') return
    const packet = {
      x: bot.entity.position.x,
      y: bot.entity.position.y,
      z: bot.entity.position.z,
      flags: { onGround: bot.entity.onGround, hasHorizontalCollision: false }
    }
    if (includeLook) {
      packet.yaw = bot.entity.yaw
      packet.pitch = bot.entity.pitch
      client.write('position_look', packet)
    } else {
      client.write('position', packet)
    }
  }

  function startMovementHeartbeat() {
    if (movementTimer) clearInterval(movementTimer)
    movementTimer = setInterval(() => {
      try { sendCurrentPosition(false) } catch (error) { bot.emit('error', error) }
    }, MOVEMENT_INTERVAL_MS)
    movementTimer.unref?.()
  }

  function ensureSpawned() {
    if (spawned) return
    spawned = true
    startMovementHeartbeat()
    bot.emit('spawn')
  }

  function exposePlayer(record) {
    if (!record?.username) return
    bot.players[record.username] = record
  }

  function removePlayer(uuid) {
    const record = uuidToPlayer.get(uuid)
    if (record?.username) delete bot.players[record.username]
    if (record?.entity) entityIdToUuid.delete(record.entity.id)
    uuidToPlayer.delete(uuid)
    pendingPlayerEntities.delete(uuid)
  }

  function attachPlayerEntity(uuid, entity) {
    const record = uuidToPlayer.get(uuid)
    entityIdToUuid.set(entity.id, uuid)
    if (!record) {
      pendingPlayerEntities.set(uuid, entity)
      return
    }
    record.entity = entity
    exposePlayer(record)
  }

  function updateRelativeEntity(packet) {
    const uuid = entityIdToUuid.get(packet.entityId)
    const entity = uuidToPlayer.get(uuid)?.entity || pendingPlayerEntities.get(uuid)
    if (!entity) return
    entity.position.x += Number(packet.dX || 0) / 4096
    entity.position.y += Number(packet.dY || 0) / 4096
    entity.position.z += Number(packet.dZ || 0) / 4096
    if (packet.yaw != null) entity.yaw = Number(packet.yaw) * Math.PI / 128
    if (packet.pitch != null) entity.pitch = Number(packet.pitch) * Math.PI / 128
  }

  client.on('connect', () => bot.emit('connect'))
  client.on('error', (error) => bot.emit('error', error))
  client.on('end', (reason) => {
    if (ended) return
    ended = true
    if (movementTimer) clearInterval(movementTimer)
    movementTimer = null
    bot.emit('end', reason)
  })
  client.on('kick_disconnect', (packet) => bot.emit('kicked', packet.reason, true))
  client.on('disconnect', (packet) => bot.emit('kicked', packet.reason, false))

  client.on('login', (packet) => {
    bot.username = client.username || bot.username
    bot.entity.id = packet.entityId
    bot.entity.username = bot.username
    const worldState = packet.worldState || packet
    bot.game.gameMode = gameModeName(worldState.gamemode ?? worldState.gameMode)
    bot.game.serverViewDistance = packet.viewDistance
    if (client._lastChatHistory) client._lastChatHistory.capacity = CHAT_HISTORY_LIMIT
    try { writeSettings() } catch (error) { bot.emit('error', error) }
    writeBrand()
    bot.emit('login')
  })

  client.on('respawn', (packet) => {
    bot.isAlive = true
    const worldState = packet.worldState || packet
    bot.game.gameMode = gameModeName(worldState.gamemode ?? worldState.gameMode)
    for (const uuid of [...uuidToPlayer.keys()]) removePlayer(uuid)
    entityIdToUuid.clear()
    pendingPlayerEntities.clear()
  })

  client.on('death_combat_event', (packet) => {
    if (!bot.isAlive) return
    bot.isAlive = false
    bot.emit('death', packet)
  })

  client.on('position', (packet) => {
    const flags = packet.flags || {}
    bot.entity.position.set(
      relativeValue(bot.entity.position.x, Number(packet.x), Boolean(flags.x)),
      relativeValue(bot.entity.position.y, Number(packet.y), Boolean(flags.y)),
      relativeValue(bot.entity.position.z, Number(packet.z), Boolean(flags.z))
    )
    bot.entity.velocity.set(
      flags.dx ? bot.entity.velocity.x + Number(packet.dx || 0) : Number(packet.dx || 0),
      flags.dy ? bot.entity.velocity.y + Number(packet.dy || 0) : Number(packet.dy || 0),
      flags.dz ? bot.entity.velocity.z + Number(packet.dz || 0) : Number(packet.dz || 0)
    )
    bot.entity.yaw = relativeValue(bot.entity.yaw, Number(packet.yaw || 0), Boolean(flags.yaw))
    bot.entity.pitch = relativeValue(bot.entity.pitch, Number(packet.pitch || 0), Boolean(flags.pitch))
    bot.entity.onGround = false
    if (packet.teleportId != null) client.write('teleport_confirm', { teleportId: packet.teleportId })
    sendCurrentPosition(true)
    ensureSpawned()
    bot.emit('forcedMove')
  })

  client.on('player_rotation', (packet) => {
    bot.entity.yaw = Number(packet.yaw || 0)
    bot.entity.pitch = Number(packet.pitch || 0)
  })

  client.on('ping', (packet) => client.write('pong', { id: packet.id }))
  client.on('chunk_batch_finished', (packet) => {
    client.write('chunk_batch_received', { chunksPerTick: 0.5 })
  })

  function acceptResourcePack(packet) {
    if (!packet?.uuid) return
    client.write('resource_pack_receive', { uuid: packet.uuid, result: RESOURCE_PACK_RESULT.ACCEPTED })
    client.write('resource_pack_receive', { uuid: packet.uuid, result: RESOURCE_PACK_RESULT.SUCCESSFULLY_LOADED })
  }
  client.on('resource_pack_send', acceptResourcePack)
  client.on('add_resource_pack', acceptResourcePack)

  client.on('systemChat', (message) => {
    emitMessage(message.formattedMessage, message.positionId === 2 ? 'game_info' : 'system')
  })
  client.on('playerChat', (message) => {
    const content = message.unsignedContent || message.formattedMessage || message.plainMessage
    emitMessage(content, 'chat')
  })

  client.on('player_info', (packet) => {
    for (const data of packet.data || []) {
      const uuid = normalizeUuid(data.uuid)
      if (!uuid) continue
      const name = data.player?.name || data.name
      let record = uuidToPlayer.get(uuid)
      if (!record && name) {
        record = { username: name, uuid, entity: null }
        uuidToPlayer.set(uuid, record)
      } else if (record && name && record.username !== name) {
        delete bot.players[record.username]
        record.username = name
      }
      const pending = pendingPlayerEntities.get(uuid)
      if (record && pending) {
        record.entity = pending
        pendingPlayerEntities.delete(uuid)
      }
      if (record) exposePlayer(record)
    }
  })

  client.on('player_remove', (packet) => {
    for (const value of packet.players || []) removePlayer(normalizeUuid(value))
  })

  client.on('spawn_entity', (packet) => {
    if (packet.type !== registry.entitiesByName.player?.id) return
    const uuid = normalizeUuid(packet.objectUUID)
    const entity = {
      id: packet.entityId,
      uuid,
      type: packet.type,
      position: new Vec3(Number(packet.x), Number(packet.y), Number(packet.z)),
      yaw: Number(packet.yaw || 0) * Math.PI / 128,
      pitch: Number(packet.pitch || 0) * Math.PI / 128
    }
    attachPlayerEntity(uuid, entity)
  })
  client.on('rel_entity_move', updateRelativeEntity)
  client.on('entity_move_look', updateRelativeEntity)
  function updateAbsoluteEntity(packet, degrees) {
    const uuid = entityIdToUuid.get(packet.entityId)
    const entity = uuidToPlayer.get(uuid)?.entity || pendingPlayerEntities.get(uuid)
    if (!entity) return
    entity.position.set(Number(packet.x), Number(packet.y), Number(packet.z))
    const scale = degrees ? Math.PI / 180 : Math.PI / 128
    entity.yaw = Number(packet.yaw || 0) * scale
    entity.pitch = Number(packet.pitch || 0) * scale
  }
  client.on('entity_teleport', (packet) => updateAbsoluteEntity(packet, false))
  // 1.21.x gửi vị trí tuyệt đối của entity qua sync_entity_position (yaw/pitch là
  // float độ, không phải byte góc). Thiếu listener này thì Whitelist Guard đọc
  // sai vị trí người lạ sau khi họ teleport.
  client.on('sync_entity_position', (packet) => updateAbsoluteEntity(packet, true))
  client.on('entity_destroy', (packet) => {
    for (const entityId of packet.entityIds || []) {
      const uuid = entityIdToUuid.get(entityId)
      const record = uuidToPlayer.get(uuid)
      if (record) record.entity = null
      entityIdToUuid.delete(entityId)
      pendingPlayerEntities.delete(uuid)
    }
  })

  return bot
}

module.exports = {
  createProtocolBot,
  safeChatText,
  normalizeUuid,
  VERSION,
  MOVEMENT_INTERVAL_MS,
  CHAT_HISTORY_LIMIT
}
