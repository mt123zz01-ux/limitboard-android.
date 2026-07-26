const { Writable } = require('node:stream')
const DefaultClient = require('minecraft-protocol/src/client')
const states = require('minecraft-protocol/src/states')
const minecraftData = require('minecraft-data')

// These packets are only used to render the world/client effects. ZCore still
// receives every byte and keeps the normal protocol state machine, but avoids
// building large JavaScript objects that the AFK client never reads.
const DEFAULT_SKIPPED_PACKET_NAMES = Object.freeze([
  'animation',
  'statistics',
  'acknowledge_player_digging',
  'block_break_animation',
  'tile_entity_data',
  'block_action',
  'block_change',
  'boss_bar',
  'chunk_biomes',
  'clear_titles',
  'debug_block_value',
  'debug_chunk_value',
  'debug_entity_value',
  'debug_event',
  'debug_sample',
  'damage_event',
  'explosion',
  'unload_chunk',
  'game_test_highlight_pos',
  'hurt_animation',
  'initialize_world_border',
  'map_chunk',
  'world_event',
  'world_particles',
  'update_light',
  'map',
  'move_minecart',
  'entity_look',
  'vehicle_move',
  'open_book',
  'open_sign_entity',
  'craft_recipe_response',
  'abilities',
  'end_combat_event',
  'enter_combat_event',
  'face_player',
  'recipe_book_add',
  'recipe_book_remove',
  'recipe_book_settings',
  'multi_block_change',
  'select_advancement_tab',
  'remove_entity_effect',
  'entity_head_rotation',
  'world_border_center',
  'world_border_lerp_size',
  'world_border_size',
  'world_border_warning_delay',
  'world_border_warning_reach',
  'camera',
  'update_view_position',
  'update_view_distance',
  'spawn_position',
  'entity_metadata',
  'attach_entity',
  'entity_velocity',
  'entity_equipment',
  'experience',
  'set_passengers',
  'simulation_distance',
  'set_title_subtitle',
  'set_title_text',
  'set_title_time',
  'update_time',
  'entity_sound_effect',
  'sound_effect',
  'stop_sound',
  'playerlist_header',
  'nbt_query_response',
  'collect',
  'test_instance_block_status',
  'set_ticking_state',
  'step_tick',
  'advancements',
  'entity_update_attributes',
  'entity_effect',
  'declare_recipes',
  'tags',
  'set_projectile_power',
  // Repair 22: các packet PLAY còn lại mà ZCore chưa từng đăng ký listener và
  // cũng không có nghĩa vụ phản hồi theo protocol.
  'chat_suggestions',
  'chunk_batch_start',
  'clear_dialog',
  'show_dialog',
  'cookie_request',
  'store_cookie',
  'craft_progress_bar',
  'custom_report_details',
  'difficulty',
  'game_state_change',
  'ping_response',
  'remove_resource_pack',
  'server_links',
  'tab_complete',
  'tracked_waypoint',
  'trade_list',
  'transfer',
  'update_health'
])

// Chỉ cần khi profile đọc số dư từ scoreboard/actionbar thay vì lệnh /balance.
const SCOREBOARD_PACKET_NAMES = Object.freeze([
  'reset_score',
  'scoreboard_display_objective',
  'scoreboard_objective',
  'scoreboard_score',
  'teams',
  'action_bar'
])

// Chỉ cần khi bật Whitelist Guard hoặc cảnh báo người lạ. Trên server đông
// người đây là nhóm packet có lưu lượng lớn nhất còn lại sau khi đã bỏ world.
const PLAYER_TRACKING_PACKET_NAMES = Object.freeze([
  'spawn_entity',
  'rel_entity_move',
  'entity_move_look',
  'entity_teleport',
  'sync_entity_position',
  'entity_destroy',
  'player_info',
  'player_remove'
])

const packetIdCache = new Map()

function packetIdsFor(version, state, packetNames = DEFAULT_SKIPPED_PACKET_NAMES) {
  const cacheKey = `${version}:${state}:${packetNames === DEFAULT_SKIPPED_PACKET_NAMES ? 'default' : [...packetNames].sort().join(',')}`
  if (packetIdCache.has(cacheKey)) return packetIdCache.get(cacheKey)

  const data = minecraftData(version)
  const packetType = data?.protocol?.[state]?.toClient?.types?.packet
  const nameField = Array.isArray(packetType?.[1])
    ? packetType[1].find((field) => field?.name === 'name')
    : null
  const mappings = nameField?.type?.[1]?.mappings || {}
  const wanted = new Set(packetNames)
  const ids = new Set()
  for (const [encodedId, name] of Object.entries(mappings)) {
    if (wanted.has(name)) ids.add(Number.parseInt(encodedId, 16))
  }
  packetIdCache.set(cacheKey, ids)
  return ids
}

function packetId(buffer) {
  let value = 0
  for (let index = 0; index < Math.min(5, buffer.length); index += 1) {
    const byte = buffer[index]
    value |= (byte & 0x7f) << (index * 7)
    if ((byte & 0x80) === 0) return value >>> 0
  }
  return null
}

class FilteredPacketSink extends Writable {
  constructor(parser, skippedIds, onSkip = () => {}) {
    super()
    this.parser = parser
    this.skippedIds = skippedIds
    this.onSkip = onSkip
  }

  _write(chunk, encoding, callback) {
    const id = packetId(chunk)
    if (id !== null && this.skippedIds.has(id)) {
      this.onSkip(chunk.length, id)
      callback()
      return
    }
    if (this.parser.write(chunk, encoding)) callback()
    else this.parser.once('drain', callback)
  }

  removeAllListeners(eventName) {
    this.parser?.removeAllListeners(eventName)
    return super.removeAllListeners(eventName)
  }
}

class UltraLiteClient extends DefaultClient {
  configureUltraLite({ scoreboardEnabled, playerTrackingEnabled } = {}) {
    if (scoreboardEnabled !== undefined) this.ultraLiteScoreboardEnabled = scoreboardEnabled === true
    if (playerTrackingEnabled !== undefined) this.ultraLitePlayerTrackingEnabled = playerTrackingEnabled === true
    if (this.deserializer instanceof FilteredPacketSink) {
      this.deserializer.skippedIds = this.skippedPacketIds()
    }
  }

  skippedPacketIds() {
    const names = [...DEFAULT_SKIPPED_PACKET_NAMES]
    if (this.ultraLiteScoreboardEnabled !== true) names.push(...SCOREBOARD_PACKET_NAMES)
    if (this.ultraLitePlayerTrackingEnabled !== true) names.push(...PLAYER_TRACKING_PACKET_NAMES)
    return packetIdsFor(this.version, states.PLAY, names)
  }

  setSerializer(state) {
    super.setSerializer(state)
    if (this.isServer || state !== states.PLAY) return

    const parser = this.deserializer
    const skippedIds = this.skippedPacketIds()
    this.deserializer = new FilteredPacketSink(parser, skippedIds, (bytes) => {
      this.skippedPacketCount = (this.skippedPacketCount || 0) + 1
      this.skippedPacketBytes = (this.skippedPacketBytes || 0) + bytes
    })
  }
}

module.exports = {
  UltraLiteClient,
  FilteredPacketSink,
  DEFAULT_SKIPPED_PACKET_NAMES,
  SCOREBOARD_PACKET_NAMES,
  PLAYER_TRACKING_PACKET_NAMES,
  packetIdsFor,
  packetId
}
