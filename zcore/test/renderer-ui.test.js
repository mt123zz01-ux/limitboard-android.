const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const rendererDirectory = path.join(__dirname, '..', 'src', 'renderer')
const html = fs.readFileSync(path.join(rendererDirectory, 'index.html'), 'utf8')
const script = fs.readFileSync(path.join(rendererDirectory, 'app.js'), 'utf8')
const css = fs.readFileSync(path.join(rendererDirectory, 'styles.css'), 'utf8')
// Bỏ comment để các assert dưới chỉ soi khai báo CSS thật, không dính chú thích.
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')
const mainScript = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
const preloadScript = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8')

test('giao diện Repair 22 giữ đủ hướng dẫn và chọn engine an toàn', () => {
  for (const text of [
    'Tạo profile đầu tiên',
    'Treo Auto Sell trong 4 bước',
    'Cấu hình khuyên dùng',
    'Thông tin kỹ thuật',
    'Protocol Max — khuyên dùng',
    'Mineflayer — chế độ tương thích'
  ]) assert.match(html, new RegExp(text))
})

test('bố cục Repair 22 lấp viewport và không dùng hiệu ứng blur tốn CPU', () => {
  // Sau khi tắt tăng tốc phần cứng, backdrop-filter do CPU vẽ lại từng khung.
  assert.doesNotMatch(cssRules, /backdrop-filter/)
  assert.doesNotMatch(cssRules, /scroll-behavior:\s*smooth/)
  assert.match(cssRules, /html,\s*body\s*\{[^}]*overflow:\s*hidden/)
  // Dải workflow 3 bước trùng nội dung với khung "việc cần làm" đã được bỏ.
  assert.doesNotMatch(html, /workflow-step/)
  assert.doesNotMatch(script, /setWorkflowState/)
})

test('renderer bỏ qua dựng lại danh sách profile khi không có gì đổi', () => {
  assert.match(script, /profileListSignature/)
  assert.match(script, /renderedProfileSignature === signature/)
})

test('mọi id trong HTML là duy nhất và selector id của renderer đều tồn tại', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length)

  const selectors = [...script.matchAll(/\$\(['"]#([^'"]+)['"]\)/g)].map((match) => match[1])
  const missing = [...new Set(selectors.filter((id) => !ids.includes(id)))]
  assert.deepEqual(missing, [])
})

test('các nút chức năng cũ vẫn có mặt sau khi đổi bố cục', () => {
  for (const id of [
    'new-profile', 'edit-profile', 'start-bot', 'stop-bot', 'reset-stats',
    'headless-mode', 'toggle-autosell', 'toggle-autohome', 'toggle-webhook', 'terminal-output',
    'command-form', 'command-input', 'command-send', 'open-logs',
    'scroll-console-bottom', 'clear-console', 'profile-form', 'auth-dialog',
    'profile-client-engine', 'engine-state', 'refresh-balance', 'duplicate-profile'
  ]) assert.match(html, new RegExp(`\\bid="${id}"`))
})

test('giao diện có đủ tùy chọn cảnh báo Webhook và xử lý người lạ', () => {
  for (const id of [
    'profile-webhook-user-id', 'profile-webhook-report', 'profile-webhook-death',
    'profile-webhook-stranger', 'profile-webhook-no-sell',
    'profile-webhook-no-sell-minutes', 'profile-webhook-offline',
    'profile-stranger-action'
  ]) assert.match(html, new RegExp(`\\bid="${id}"`))
  assert.match(html, /Cảnh báo chết/)
  assert.match(html, /Cảnh báo người lạ/)
  assert.match(html, /Cảnh báo không sell/)
  assert.match(html, /Cảnh báo OFFLINE/)
  assert.match(preloadScript, /duplicateProfile/)
  assert.match(mainScript, /profiles:duplicate/)
})

test('khu vực số dư có trạng thái dễ hiểu và nút cập nhật thủ công', () => {
  assert.match(html, /Theo dõi số dư/)
  assert.match(html, /Dùng \/balance tự động/)
  assert.match(html, /Cập nhật ngay/)
  assert.match(script, /Đang chờ server trả lời/)
  assert.match(script, /Server chưa trả lời/)
  assert.match(script, /TẮT HOÀN TOÀN/)
})

test('Auto Sell có quickAll và cho chỉnh toàn bộ delay', () => {
  for (const text of [
    'Auto Sell liên tục',
    'Có ít nhất một vật phẩm',
    'GUI 90 slot',
    'quickAll'
  ]) assert.match(html, new RegExp(text))

  for (const id of [
    'profile-auto-sell-delay',
    'profile-auto-sell-random',
    'profile-auto-sell-delay-min',
    'profile-auto-sell-delay-max',
    'profile-auto-sell-check-delay-min',
    'profile-auto-sell-check-delay-max',
    'profile-auto-sell-quick-delay-min',
    'profile-auto-sell-quick-delay-max',
    'profile-auto-sell-move-delay-min',
    'profile-auto-sell-move-delay-max',
    'profile-auto-sell-gui-timeout',
    'profile-auto-sell-error-cooldown',
    'profile-auto-sell-tick-ms'
  ]) assert.match(html, new RegExp(`\\bid="${id}"`))
  assert.match(html, /Random Min → Max/)
  assert.match(html, /GUI timeout/)
  assert.match(html, /Nhịp xử lý/)
  assert.doesNotMatch(html, /Slot 53/)
  assert.doesNotMatch(script, /sellSettings/)
  assert.match(script, /CHỜ CÓ VẬT PHẨM/)
  assert.match(script, /ĐANG GỬI \/SELL/)
  assert.match(script, /ĐANG QUICKALL/)
  assert.match(script, /ĐÃ HOÀN TẤT/)
})

test('AutoSellAxe Member có công tắc riêng và loại trừ Auto Sell', () => {
  for (const id of [
    'toggle-autosell-axe',
    'profile-auto-sell-axe',
    'profile-auto-sell-axe-look-up'
  ]) assert.match(html, new RegExp(`\\bid="${id}"`))
  assert.match(html, /AutoSellAxe Member/)
  assert.match(html, /Giữ chuột trái liên tục/)
  assert.match(html, /Mỗi 5 phút kiểm tra một lần/)
  assert.match(script, /syncAutoSellModes/)
  assert.match(script, /autoSellAxeEnabled/)
})

test('Auto Home dễ bật tắt, chọn Home 1–4 và delay theo phút', () => {
  for (const id of [
    'toggle-autohome',
    'autohome-summary',
    'profile-auto-home',
    'profile-auto-home-number',
    'profile-auto-home-delay'
  ]) assert.match(html, new RegExp(`\\bid="${id}"`))
  assert.match(html, /Auto Home định kỳ/)
  assert.match(html, /\/home 1–4/)
  assert.match(html, /Gửi Home mỗi/)
  assert.match(script, /autoHomeEnabled/)
  assert.match(script, /autoHomeNumber/)
  assert.match(script, /autoHomeDelayMinutes/)
})

test('Electron tắt GPU process và các subsystem renderer không dùng', () => {
  assert.match(mainScript, /app\.disableHardwareAcceleration\(\)/)
  assert.match(mainScript, /disable-software-rasterizer/)
  for (const option of ['spellcheck: false', 'webgl: false', 'enableWebSQL: false']) {
    assert.match(mainScript, new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  // Cấu hình bảo mật Electron không được nới lỏng khi tối ưu.
  for (const option of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true']) {
    assert.match(mainScript, new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('tự chuyển Treo siêu nhẹ chỉ sau khi toàn bộ profile ONLINE', () => {
  assert.match(mainScript, /AUTO_HEADLESS_DELAY_MS = 15_000/)
  assert.match(mainScript, /manager\.runtimes\.get\(profile\.id\)\?\.status === 'online'/)
  assert.match(mainScript, /dialog\[open\]/)
  assert.match(preloadScript, /onAutoHeadless/)
  assert.match(script, /Tất cả tài khoản đã ONLINE/)
})
