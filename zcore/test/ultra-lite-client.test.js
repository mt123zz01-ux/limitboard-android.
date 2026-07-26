const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const states = require('minecraft-protocol/src/states')
const { createSerializer } = require('minecraft-protocol/src/transforms/serializer')
const {
  UltraLiteClient,
  FilteredPacketSink,
  DEFAULT_SKIPPED_PACKET_NAMES,
  SCOREBOARD_PACKET_NAMES,
  PLAYER_TRACKING_PACKET_NAMES,
  packetIdsFor
} = require('../src/core/UltraLiteClient')

function serialize(name, params) {
  return new Promise((resolve, reject) => {
    const serializer = createSerializer({ state: states.PLAY, version: '1.21.11', isServer: true })
    serializer.once('error', reject)
    serializer.once('data', resolve)
    serializer.write({ name, params })
  })
}

test('bộ lọc chỉ hoạt động ở PLAY; login và configuration vẫn dùng parser đầy đủ', () => {
  const client = new UltraLiteClient(false, '1.21.11', undefined, true)
  assert.equal(client.deserializer instanceof FilteredPacketSink, false)
  client.state = states.CONFIGURATION
  assert.equal(client.deserializer instanceof FilteredPacketSink, false)
  client.state = states.PLAY
  assert.equal(client.deserializer instanceof FilteredPacketSink, true)
})

test('packet render nặng bị bỏ trước decode nhưng ping thiết yếu vẫn đi qua', async () => {
  const client = new UltraLiteClient(false, '1.21.11', undefined, true)
  const errors = []
  client.on('error', (error) => errors.push(error))
  client.state = states.PLAY

  const mapChunkId = [...packetIdsFor('1.21.11', states.PLAY, ['map_chunk'])][0]
  await new Promise((resolve, reject) => {
    client.deserializer.write(Buffer.from([mapChunkId]), (error) => error ? reject(error) : resolve())
  })
  assert.equal(client.skippedPacketCount, 1)
  assert.deepEqual(errors, [])

  const ping = once(client, 'ping')
  client.deserializer.write(await serialize('ping', { id: 1234 }))
  assert.deepEqual((await ping)[0], { id: 1234 })

  const position = once(client, 'position')
  client.deserializer.write(await serialize('position', {
    teleportId: 9,
    x: 12.5,
    y: 64,
    z: -7,
    dx: 0,
    dy: 0,
    dz: 0,
    yaw: 90,
    pitch: 0,
    flags: 0
  }))
  assert.equal((await position)[0].teleportId, 9)
})

test('không lọc packet bắt buộc để vào server, chat, inventory và Auto Sell', () => {
  const skipped = new Set([...DEFAULT_SKIPPED_PACKET_NAMES, ...SCOREBOARD_PACKET_NAMES])
  for (const name of [
    'keep_alive',
    'login',
    'respawn',
    'position',
    'start_configuration',
    'server_data',
    'custom_payload',
    'declare_commands',
    'player_chat',
    'system_chat',
    'open_window',
    'close_window',
    'window_items',
    'set_slot',
    'set_player_inventory',
    'set_cursor_item',
    'held_item_slot',
    'chunk_batch_finished',
    'add_resource_pack'
  ]) assert.equal(skipped.has(name), false, `${name} không được phép lọc`)
})

test('packet Auto Sell không bao giờ bị lọc dù bật cấu hình tiết kiệm nhất', () => {
  // Ràng buộc cứng của Repair 22: mọi tối ưu packet phải không đụng Auto Sell.
  const everySkip = new Set([
    ...DEFAULT_SKIPPED_PACKET_NAMES,
    ...SCOREBOARD_PACKET_NAMES,
    ...PLAYER_TRACKING_PACKET_NAMES
  ])
  for (const name of [
    'open_window', 'close_window', 'window_items', 'set_slot',
    'set_player_inventory', 'set_cursor_item', 'held_item_slot',
    'keep_alive', 'login', 'respawn', 'position', 'player_rotation',
    'ping', 'chunk_batch_finished', 'add_resource_pack', 'resource_pack_send',
    'player_chat', 'system_chat', 'death_combat_event', 'kick_disconnect'
  ]) assert.equal(everySkip.has(name), false, `${name} không được phép lọc`)
})

test('packet người chơi chỉ decode khi bật Whitelist Guard hoặc cảnh báo người lạ', () => {
  const client = new UltraLiteClient(false, '1.21.11', undefined, true)
  client.state = states.PLAY
  const moveId = [...packetIdsFor('1.21.11', states.PLAY, ['rel_entity_move'])][0]
  const infoId = [...packetIdsFor('1.21.11', states.PLAY, ['player_info'])][0]
  assert.equal(client.deserializer.skippedIds.has(moveId), true)
  assert.equal(client.deserializer.skippedIds.has(infoId), true)

  client.configureUltraLite({ playerTrackingEnabled: true })
  assert.equal(client.deserializer.skippedIds.has(moveId), false)
  assert.equal(client.deserializer.skippedIds.has(infoId), false)

  // Đổi riêng cờ scoreboard không được vô tình bật lại nhóm người chơi.
  client.configureUltraLite({ scoreboardEnabled: true })
  assert.equal(client.deserializer.skippedIds.has(moveId), false)
  client.configureUltraLite({ playerTrackingEnabled: false })
  assert.equal(client.deserializer.skippedIds.has(moveId), true)
})

test('mọi tên packet trong danh sách lọc đều tồn tại thật ở 1.21.11', () => {
  const known = new Set(Object.values(
    require('minecraft-data')('1.21.11').protocol.play.toClient.types.packet[1]
      .find((field) => field.name === 'name').type[1].mappings
  ))
  for (const name of [
    ...DEFAULT_SKIPPED_PACKET_NAMES,
    ...SCOREBOARD_PACKET_NAMES,
    ...PLAYER_TRACKING_PACKET_NAMES
  ]) assert.equal(known.has(name), true, `${name} không có trong protocol 1.21.11`)
})

test('scoreboard chỉ được decode khi profile chọn nguồn số dư scoreboard/chat', () => {
  const client = new UltraLiteClient(false, '1.21.11', undefined, true)
  client.state = states.PLAY
  const scoreboardId = [...packetIdsFor('1.21.11', states.PLAY, ['scoreboard_score'])][0]
  assert.equal(client.deserializer.skippedIds.has(scoreboardId), true)
  client.configureUltraLite({ scoreboardEnabled: true })
  assert.equal(client.deserializer.skippedIds.has(scoreboardId), false)
})
