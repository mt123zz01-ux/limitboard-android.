const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const { createSerializer } = require('minecraft-protocol/src/transforms/serializer')
const registryLoader = require('prismarine-registry')
const { createProtocolBot, CHAT_HISTORY_LIMIT } = require('../src/core/ProtocolBot')

class FakeClient extends EventEmitter {
  constructor() {
    super()
    this.state = 'play'
    this.username = 'ProtocolTester'
    this.writes = []
    this._lastChatHistory = { capacity: 1024 }
  }

  write(name, params) {
    this.writes.push({ name, params })
  }

  chat(message) {
    this.writes.push({ name: 'chat', params: { message } })
  }

  end(reason) {
    this.emit('end', reason)
  }

  registerChannel() {}
  writeChannel() {}
}

function createFakeBot() {
  const client = new FakeClient()
  const bot = createProtocolBot({
    username: 'account@example.com',
    clientFactory: () => client
  })
  bot.on('error', () => {})
  return { bot, client }
}

function packet(client, name) {
  return client.writes.findLast((entry) => entry.name === name)?.params
}

function assertPacketSerializes(name, params) {
  return new Promise((resolve, reject) => {
    const serializer = createSerializer({ state: 'play', version: '1.21.11' })
    serializer.once('error', reject)
    serializer.once('data', (data) => {
      assert.ok(data.length > 0)
      resolve()
    })
    serializer.write({ name, params })
  })
}

test('Protocol Max hoàn tất login, teleport, ping và movement mà không cần world/physics', async () => {
  const { bot, client } = createFakeBot()
  const spawned = once(bot, 'spawn')
  client.emit('login', {
    entityId: 77,
    worldState: { gamemode: 0 },
    viewDistance: 10
  })
  client.emit('position', {
    teleportId: 9,
    x: 12.5,
    y: 64,
    z: -7,
    dx: 0,
    dy: 0,
    dz: 0,
    yaw: 90,
    pitch: 0,
    flags: {}
  })
  await spawned
  client.emit('ping', { id: 1234 })
  client.emit('chunk_batch_finished', { batchSize: 64 })

  assert.equal(bot.entity.id, 77)
  assert.deepEqual([bot.entity.position.x, bot.entity.position.y, bot.entity.position.z], [12.5, 64, -7])
  assert.equal(packet(client, 'settings').viewDistance, 2)
  assert.equal(packet(client, 'settings').particleStatus, 'minimal')
  assert.deepEqual(packet(client, 'teleport_confirm'), { teleportId: 9 })
  assert.deepEqual(packet(client, 'pong'), { id: 1234 })
  assert.deepEqual(packet(client, 'chunk_batch_received'), { chunksPerTick: 0.5 })
  assert.equal(client._lastChatHistory.capacity, CHAT_HISTORY_LIMIT)
  assert.equal(bot.world, undefined)
  assert.equal(client.listenerCount('map_chunk'), 0)
  assert.equal(bot.listenerCount('physicsTick'), 0)
  await assertPacketSerializes('settings', packet(client, 'settings'))
  await assertPacketSerializes('position_look', packet(client, 'position_look'))
  await assertPacketSerializes('chunk_batch_received', packet(client, 'chunk_batch_received'))
  bot.quit('test complete')
})

test('Protocol Max gửi chuột trái và nhìn thẳng lên trời dù GUI đang mở', async () => {
  const { bot, client } = createFakeBot()
  bot.currentWindow = { id: 5, slots: Array(90).fill(null) }
  bot.entity.yaw = 35
  bot.entity.pitch = 20

  assert.equal(bot.zcoreSwingLeft(), true)
  assert.equal(bot.zcoreLookStraightUp(), true)
  assert.deepEqual(packet(client, 'arm_animation'), { hand: 0 })
  assert.equal(packet(client, 'look').yaw, 35)
  assert.equal(packet(client, 'look').pitch, -90)
  assert.equal(bot.zcoreIsLookingStraightUp(), true)
  await assertPacketSerializes('arm_animation', packet(client, 'arm_animation'))
  await assertPacketSerializes('look', packet(client, 'look'))
  bot.quit('test complete')
})

test('chat nặng chỉ được chuyển thành text khi BotSession đang cần', () => {
  const { bot, client } = createFakeBot()
  const messages = []
  bot.on('messagestr', (message) => messages.push(message))
  bot.shouldProcessMessage = () => false
  client.emit('systemChat', { formattedMessage: { text: 'bỏ qua' }, positionId: 0 })
  assert.deepEqual(messages, [])

  bot.shouldProcessMessage = () => true
  client.emit('systemChat', { formattedMessage: { text: 'giữ lại' }, positionId: 0 })
  assert.deepEqual(messages, ['giữ lại'])
  bot.quit('test complete')
})

test('Protocol Max phát sự kiện chết một lần và mở lại sau respawn', () => {
  const { bot, client } = createFakeBot()
  let deaths = 0
  bot.on('death', () => { deaths += 1 })
  client.emit('death_combat_event', { playerId: 1 })
  client.emit('death_combat_event', { playerId: 1 })
  assert.equal(deaths, 1)
  assert.equal(bot.isAlive, false)
  client.emit('respawn', { worldState: { gamemode: 0 } })
  assert.equal(bot.isAlive, true)
  client.emit('death_combat_event', { playerId: 1 })
  assert.equal(deaths, 2)
})

test('Protocol Max giữ inventory, GUI 90 slot, stateId và packet quickAll', async () => {
  const { bot, client } = createFakeBot()
  const registry = registryLoader('1.21.11')
  const empty = { itemCount: 0, components: [], removeComponents: [] }
  const playerItem = {
    itemCount: 1,
    itemId: registry.itemsByName.stone.id,
    addedComponentCount: 0,
    removedComponentCount: 0,
    components: [],
    removeComponents: []
  }

  const opened = once(bot, 'windowOpen')
  client.emit('open_window', {
    windowId: 3,
    inventoryType: 5,
    windowTitle: { type: 'string', value: 'Sell' }
  })
  const items = Array.from({ length: 90 }, () => ({ ...empty }))
  items[54] = playerItem
  client.emit('window_items', {
    windowId: 3,
    stateId: 41,
    items,
    carriedItem: empty
  })
  await opened

  assert.equal(bot.currentWindow.type, 'minecraft:generic_9x6')
  assert.equal(bot.currentWindow.inventoryStart, 54)
  assert.equal(bot.currentWindow.slots[54].name, 'stone')
  await bot.clickWindow(54, 0, 1)

  const click = packet(client, 'window_click')
  assert.equal(click.windowId, 3)
  assert.equal(click.stateId, 41)
  assert.equal(click.slot, 54)
  assert.equal(click.mode, 1)
  await assertPacketSerializes('window_click', click)
})

test('Protocol Max chỉ lưu entity người chơi cần cho whitelist guard', () => {
  const { bot, client } = createFakeBot()
  const registry = registryLoader('1.21.11')
  const uuid = '12345678-1234-1234-1234-123456789abc'
  client.emit('player_info', {
    action: { add_player: true },
    data: [{ uuid, player: { name: 'NearbyPlayer', properties: [] } }]
  })
  client.emit('spawn_entity', {
    entityId: 44,
    objectUUID: uuid,
    type: registry.entitiesByName.player.id,
    x: 2,
    y: 64,
    z: 3,
    yaw: 0,
    pitch: 0
  })
  client.emit('spawn_entity', {
    entityId: 45,
    objectUUID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    type: registry.entitiesByName.zombie.id,
    x: 1,
    y: 64,
    z: 1,
    yaw: 0,
    pitch: 0
  })

  assert.equal(bot.players.NearbyPlayer.entity.id, 44)
  assert.equal(Object.keys(bot.players).length, 1)
  client.emit('rel_entity_move', { entityId: 44, dX: 4096, dY: 0, dZ: -4096 })
  assert.deepEqual(
    [bot.players.NearbyPlayer.entity.position.x, bot.players.NearbyPlayer.entity.position.z],
    [3, 2]
  )
  client.emit('entity_destroy', { entityIds: [44] })
  assert.equal(bot.players.NearbyPlayer.entity, null)
})

test('năm Protocol Max client giữ state và vòng đời độc lập', async () => {
  const clients = Array.from({ length: 5 }, (_, index) => {
    const pair = createFakeBot()
    pair.bot.on('error', () => {})
    pair.spawned = once(pair.bot, 'spawn')
    pair.client.username = `Account${index + 1}`
    pair.client.emit('login', {
      entityId: index + 1,
      worldState: { gamemode: 0 },
      viewDistance: 10
    })
    pair.client.emit('position', {
      teleportId: index + 100,
      x: index * 10,
      y: 64,
      z: index * -10,
      dx: 0,
      dy: 0,
      dz: 0,
      yaw: 0,
      pitch: 0,
      flags: {}
    })
    return pair
  })
  await Promise.all(clients.map((pair) => pair.spawned))

  clients[2].bot.quit('isolation test')
  assert.deepEqual(clients.map((pair) => pair.bot.entity.position.x), [0, 10, 20, 30, 40])
  assert.equal(clients[2].client.listenerCount('map_chunk'), 0)
  for (const [index, pair] of clients.entries()) {
    if (index !== 2) pair.bot.quit('test complete')
  }
})
