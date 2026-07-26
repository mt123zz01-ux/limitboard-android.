# ZCore 0.2.4 Repair 22

## Nhẹ hết mức + bố cục GUI mới — Repair 22

Ràng buộc của bản này: **không sửa một byte nào** trong `AutoSellController.js`,
`AutoSellAxeController.js` và `AutoHomeController.js`. Đã kiểm chứng bằng SHA-256
và bằng test tự động chặn mọi packet Auto Sell khỏi bộ lọc.

### RAM / CPU / GPU

- Tắt hẳn tăng tốc phần cứng Electron (`app.disableHardwareAcceleration()`).
  Giao diện ZCore chỉ là DOM tĩnh nên GPU process không mang lại gì; bỏ nó là bỏ
  trọn một process cùng toàn bộ texture trong VRAM.
- Renderer không nạp spellcheck, WebGL và WebSQL; thêm `v8CacheOptions: 'code'`
  và `paintWhenInitiallyHidden: false`.
- Bộ lọc packet PLAY mở rộng từ 83 lên 96 packet luôn bị bỏ trước bước decode.
  Thêm 18 packet mà ZCore chưa từng đăng ký listener và cũng không phải trả lời.
- Nhóm packet người chơi (`spawn_entity`, `rel_entity_move`, `entity_move_look`,
  `entity_teleport`, `sync_entity_position`, `entity_destroy`, `player_info`,
  `player_remove`) chỉ được decode khi bật Whitelist Guard hoặc cảnh báo người
  lạ. Mặc định cả hai đều tắt, nên tổng số packet bị lọc là 110/139 (79%).
  Trên server đông người đây là nhóm có lưu lượng lớn nhất còn lại.
- `action_bar` gộp vào nhóm số dư dự phòng: chỉ decode khi profile đọc số dư từ
  scoreboard/chat thay vì lệnh `/balance`.
- Worker được đặt `maxYoungGenerationSizeMb: 8`. Bot AFK sinh rất ít object ngắn
  hạn nên semi-space mặc định là lãng phí.

Đo thực tế với 5 worker thật, chỉ tính nạp protocol stack, chưa kết nối server:

| | Repair 21 | Repair 22 |
|---|---|---|
| RSS cho 5 account | 101,9 MB | 78,0 MB |
| RSS mỗi account | 20,4 MB | 15,6 MB |
| Heap mỗi worker | 33,4 MB | 31,2 MB |
| Packet PLAY bị lọc | 83/139 (60%) | 110/139 (79%) |

### Sửa lỗi kèm theo

- Thêm listener `sync_entity_position`. Minecraft 1.21.x gửi vị trí tuyệt đối của
  entity qua packet này (yaw/pitch là float độ, không phải byte góc); thiếu nó thì
  Whitelist Guard đọc sai vị trí người lạ sau khi họ teleport.
- Mất single-instance lock nay `app.exit(0)` ngay thay vì `app.quit()` rồi vẫn
  chạy tiếp phần khởi tạo.

### Bố cục GUI

- Ứng dụng lấp đúng viewport; chỉ danh sách profile, console và cột thống kê được
  cuộn. Bỏ `min-height` cứng khiến cả trang phải cuộn.
- Bỏ dải workflow 3 bước vì trùng nội dung với khung "việc cần làm tiếp theo".
- Start / Dừng / Treo siêu nhẹ chuyển lên topbar; Hướng dẫn, Sao chép, Cài đặt
  thu thành nút biểu tượng.
- Ô nhập lệnh gộp vào trong khung console thành một khối liền mạch.
- Cột thống kê: thẻ số dư nổi bật, lưới 2×2 cho thời gian treo / lượt sell / thu
  nhập / trung bình giờ, rồi danh sách trạng thái.
- Bỏ toàn bộ `backdrop-filter` và `scroll-behavior: smooth`. Sau khi tắt tăng tốc
  phần cứng, mọi hiệu ứng blur đều do CPU vẽ lại từng khung hình.
- Renderer bỏ qua dựng lại `innerHTML` của danh sách profile khi chữ ký không đổi,
  thay vì dựng lại theo từng state event (mặc định 5 giây/account).

### Kiểm thử

- 124/124 bài đạt (118 bài cũ giữ nguyên + 6 bài mới).
- Bài mới chặn hồi quy: packet Auto Sell không bao giờ bị lọc dù bật cấu hình
  tiết kiệm nhất; nhóm packet người chơi bật/tắt độc lập với cờ scoreboard; mọi
  tên packet trong danh sách lọc phải tồn tại thật trong protocol 1.21.11; cấu
  hình bảo mật Electron không bị nới lỏng khi tối ưu.

## AutoSellAxe Member — Repair 21

- Thêm `AutoSellAxeController` với chu kỳ gửi chuột trái 100 ms và kiểm tra nhìn lên trời 300.000 ms.
- Auto Sell thường và AutoSellAxe được chuẩn hóa loại trừ tại ProfileStore, BotManager, IPC và renderer.
- Protocol Max triển khai `zcoreSwingLeft()` bằng packet `arm_animation { hand: 0 }`.
- Protocol Max triển khai `zcoreLookStraightUp()` bằng packet `look`, giữ yaw hiện tại và đặt pitch `-90°`.
- Controller không kiểm tra `currentWindow`, vì vậy packet chuột trái vẫn được gửi trong lúc GUI mở.
- Controller được tạo lại sau mỗi lần spawn nên tự tiếp tục sau reconnect nếu setting profile vẫn bật.
- Tự nhìn lên trời bật/tắt độc lập; nếu pitch đã nằm trong sai số 1° thì không gửi packet thừa.
- 118 bài kiểm thử tự động đạt, gồm packet serialization Minecraft 1.21.11, GUI đang mở, reconnect, góc nhìn và loại trừ module.

## Toàn bộ delay Auto Sell có thể chỉnh — Repair 20

- Mặc định khuyên dùng mới: kiểm tra inventory 100–200 ms, nghỉ giữa nhóm quickAll 50–100 ms, chờ server trước đóng GUI 250–400 ms và delay vòng 150–300 ms.
- Random delay vòng bán bật mặc định; fixed delay dự phòng là 200 ms.
- GUI timeout mặc định 3.000 ms, lỗi nghỉ 1.000 ms và tick xử lý 50 ms.
- Giao diện profile có đủ input cho cả bảy nhóm thời gian; cặp Min–Max được tự đảo khi người dùng nhập ngược.
- `AutoSellController` lấy delay trực tiếp từ profile và đổi tick interval ngay cả khi đang chạy.
- Không sửa quy tắc nhận GUI 90 slot, phạm vi 36 slot người chơi, cách nhóm quickAll, state `WAITING_AFTER_SELL`, Webhook hoặc sao chép profile.
- 108 bài kiểm thử tự động đạt.

## Webhook và sao chép profile Repair 19

- Thêm lựa chọn Webhook: báo cáo định kỳ, chết, người lạ, không sell và OFFLINE; mỗi loại bật/tắt độc lập.
- Thêm thời gian cảnh báo không sell 1–1440 phút và Discord User ID để `@user`.
- Không sell dùng timeout một lần, đặt lại sau mỗi lượt Auto Sell hoàn tất, tránh polling và tránh tăng CPU.
- Cảnh báo chết đọc packet `death_combat_event` nhỏ trong Protocol Max; không bật lại world/physics.
- Người lạ chỉ báo một lần khi mới vào bán kính, có ba cách xử lý: tiếp tục sell, tạm dừng rồi tự tiếp tục khi an toàn, hoặc thoát game.
- Thêm sao chép profile: giữ server/proxy/Webhook/Auto Sell/Auto Home/bảo vệ; tách UUID, token Microsoft, email và thống kê.
- 106 bài test tự động; hash `AutoSellController.js` giữ nguyên: `3e157e68a5de0c474664e618880a3fdf0ec0f8a9494ed050c7d4aff913de0910`.

## Setup Finish Hotfix Repair 18.1

- `launchLink` luôn trỏ thẳng tới `$INSTDIR\ZCore.exe` thay vì ưu tiên shortcut Start Menu.
- Tránh lỗi `This file does not have an app associated with it` trên Windows không xử lý được `.lnk` qua `ExecShellAsUser`.
- Giữ nguyên việc tạo shortcut, toàn bộ runtime và dữ liệu Repair 18.

## Microsoft Auth và reconnect Repair 18

- Thay luồng `minecraft-protocol` làm mất nguyên nhân lỗi profile bằng authenticator cục bộ tương thích: profile được gọi trực tiếp nên ZCore phân biệt HTTP 404 với lỗi mạng, timeout, 5xx và `fetch failed`.
- HTTP 401 làm mới Minecraft access token một lần; HTTP 404 mới được xem là tài khoản không có hồ sơ Minecraft Java.
- Lỗi auth trước TCP được dọn phiên ngay và tự reconnect, không phụ thuộc sự kiện `end` mà thư viện không phát trong nhánh này.
- Cache Microsoft không bị xóa khi auth server lỗi. Backoff auth là 30–300 giây và vẫn có stagger 0–8 giây theo profile.
- Reset network watchdog ở mỗi connect/spawn để giám sát tiếp tục hoạt động qua nhiều phiên.
- Auto Sell, random delay, Auto Home và packet logic của Repair 17 được giữ nguyên.
- 92/92 bài kiểm thử Node.js đạt.

## Auto Sell Random và Auto Home Repair 17

- Kiểm tra túi trống dùng random Min–Max, mặc định 500–800 ms và cho phép chỉnh 0,05–60 giây.
- `/sell` chỉ chờ GUI đúng 90 slot tối đa 3.000 ms. Timeout quay về kiểm tra túi sau delay Min–Max, không đóng GUI sai loại.
- Mỗi nhóm `quickAll` nghỉ random 50–150 ms; sau khi chuyển xong nghỉ random 500–700 ms trước khi gửi packet đóng cửa sổ.
- Lỗi click được ghi log, đóng đúng GUI Sell đang theo dõi nếu còn mở, nghỉ 1.000 ms rồi tiếp tục.
- `AutoHomeController` gửi `/home 1` đến `/home 4` theo chu kỳ 1–1.440 phút, mặc định tắt và mặc định Home 1 mỗi 5 phút.
- Chu kỳ Home bắt đầu sau khi profile ONLINE. Nếu GUI Sell đang mở hoặc controller đang quickAll, Auto Home retry sau 1.000 ms cho đến khi an toàn.
- Trước khi gửi Home, Auto Sell được pause có gắn lý do; chỉ tự resume sau 3.000 ms nếu chính Auto Home đã pause, tránh ghi đè trạng thái pause của cơ chế bảo vệ.
- Thay đổi bật/tắt, số Home hoặc delay có hiệu lực khi đang ONLINE và reschedule từ thời điểm lưu.
- Setup và Portable được build tuần tự trong hai thư mục riêng; Setup tắt differential package vì ứng dụng không dùng cập nhật vi sai. Cả payload 7z và uninstaller đều được kiểm tra CRC sau khi đóng gói.
- 85/85 bài kiểm thử Node.js đạt.

## Tối ưu nhiều account Repair 16

- Giữ nguyên chuỗi thao tác Auto Sell của Repair 15. Chỉ thay hằng số nghỉ sau khi đóng GUI bằng delay cố định hoặc giá trị random trong `Min → Max`; mặc định vẫn là 1.000 ms.
- `UltraLiteClient` lọc packet world/render không dùng ở trạng thái PLAY trước khi ProtoDef tạo object. Trạng thái LOGIN/CONFIGURATION không lọc; các packet keepalive, login, position, chat ký số, inventory/window và resource pack được kiểm thử là danh sách bắt buộc.
- Packet scoreboard chỉ được decode khi profile bật theo dõi số dư và tắt `/balance` để dùng fallback.
- ProtocolBot giảm tốc độ nhận chunk batch xuống 0,5 chunk/tick. Start profile cách nhau 8.000 ms; reconnect dùng offset ổn định trong cửa sổ 8.000 ms.
- Chuyển chat component thành text theo nhu cầu; khi Treo siêu nhẹ, không console, không chờ balance và ngoài cửa sổ thống kê sell thì bỏ bước chuyển đổi.
- `balanceTrackingEnabled=false` tắt timer `/balance`, listener/poll scoreboard, parser text số dư và packet scoreboard.
- Khi toàn bộ profile ONLINE, main process chờ 15.000 ms rồi tự hủy renderer để vào Treo siêu nhẹ; hộp thoại đang mở sẽ hoãn việc chuyển chế độ.
- Worker heartbeat 10 giây khi mở UI/15 giây khi headless; state trùng chỉ heartbeat 30 giây, debounce 200 ms, log IPC 250 ms/50 dòng.
- Worker không giữ cache log thứ ba; BotManager và renderer vẫn giữ 100 dòng gần nhất, file log giữ đầy đủ theo lô 2 giây/64 KB.
- Snapshot thống kê nhiều profile được gom vào một lần `ProfileStore.updateMany`, tránh mỗi account ghi lại toàn bộ `profiles.json`.
- Start, login/configuration, GUI 90 slot, quickAll mode 1, random delay, Balance off, 5 worker độc lập và packet filter đều có test tự động.

## Logic Bùa Lỗ Ban Repair 15

- Copy luồng thành công của `Bùa Lỗ Ban.txt`: kiểm tra 36 slot cuối → `/sell` → GUI 90 slot → `quickAll` → chờ 1 giây → ESC → chờ 1 giây → lặp.
- Các hằng số được cố định: kiểm tra túi 1.000 ms, timeout GUI 5.000 ms, chờ sau quickAll 1.000 ms và chờ sau khi đóng 1.000 ms.
- `quickAll` xử lý tất cả stack giống item và components trong vùng 54–89; map `moved[id]` bảo đảm mỗi ID chỉ được gọi một lần như source gốc.
- Không còn click slot 53, dọn 45–52, initial delay, random Min–Max, chia batch hoặc retry cấu hình.
- Xóa thẻ cài đặt Auto Sell khỏi GUI; profile chỉ giữ công tắc `autoSellEnabled`, mọi `sellSettings` cũ bị loại khi nạp/lưu.
- Protocol Max gửi packet shift-click mode 1 và đóng cửa sổ bằng packet tương đương thao tác ESC.
- 61/61 bài kiểm thử Node.js đạt.
- SHA-256 `AutoSellController.js`: `d5ee9693c2b0cd7e65bfe0c221731b6b57aaae994c105c7ffec69e08aaebaa89`.

## Auto Sell liên tục Repair 14

- Không còn chờ inventory gần đầy: bật Auto Sell, chờ 20 tick rồi gửi `/sell`.
- Giữ nguyên bố cục logic JAR: dọn 45–52, chuyển inventory vào 0–44 và xác nhận tại slot 53.
- GUI đang mở nhưng chưa có item sẽ được kiểm tra lại mỗi 20 tick; controller không tự dừng.
- Sau mỗi lần xác nhận, GUI được đóng an toàn và chu kỳ `/sell` kế tiếp chạy sau delay ngẫu nhiên.
- Delay chuyển item, delay chu kỳ và số stack mỗi nhịp đều có Min–Max riêng trong giao diện.
- `confirmedWindowId` bảo đảm mỗi Window ID chỉ click slot 53 một lần.
- Click thất bại chuyển sang `ERROR_COOLDOWN`, log lỗi, đóng GUI và thử lại sau 1 giây.
- Chỉ sự kiện `WAITING_AFTER_SELL` có `confirmed=true` mới mở ngữ cảnh thống kê lượt bán.
- Profile cũ dùng `moveDelayTicks`, `sellDelayTicks`, `postSellWaitMs`, `sellCycleCooldownMs` và `itemsPerTick` được migration tự động.
- 60/60 bài test Node.js đạt sau khi thay logic.

## `/balance` chính xác Repair 13

- Mỗi account có trạng thái yêu cầu số dư riêng: thời điểm gửi, deadline 15 giây, phản hồi cuối và lỗi gửi gần nhất.
- Parser phản hồi lệnh được neo toàn dòng; chỉ nhận thông báo số dư của chính tài khoản và loại `/pay`, nhận/chuyển tiền, bán hàng hoặc chat người chơi.
- `/balance` nhập thủ công trong console cũng mở trạng thái chờ; phản hồi không còn phụ thuộc việc lệnh được gửi bởi timer.
- Giao diện có nút cập nhật ngay và hiển thị đang chờ, timeout hoặc thời gian cập nhật gần nhất.
- Timeout không xóa số dư hợp lệ trước đó; timer tự động vẫn chạy mỗi 30 giây và giãn thời điểm giữa các profile.
- Bộ test tăng lên 53 bài và toàn bộ đều đạt.
- `AutoSellController.js` giữ nguyên SHA-256 `4a2e242ad89f2b0a05ec60a3694fc53ec29c1379f4f1f1b11c264ada31a24e76`.

## Protocol Max Repair 12

- Engine mặc định chuyển từ Mineflayer đầy đủ sang adapter `minecraft-protocol` tối giản.
- Không nạp world, chunk cache, block/light updates, physics 20 TPS, mob/entity ngoài player, particle, sound, recipe và các plugin GUI không dùng.
- Adapter vẫn cung cấp đúng interface mà Auto Sell đang dùng: `inventory`, `currentWindow`, `chat`, `clickWindow`, `closeWindow`, `messagestr`, `players`, `entity.position`, `login`, `spawn`, `kicked`, `error` và `end`.
- Giữ inventory/window implementation đã kiểm chứng để xử lý `open_window`, `window_items`, `set_slot`, `set_player_inventory`, `set_cursor_item`, `stateId` và click slot 53.
- Tự phản hồi ping/pong, teleport confirm, position tối thiểu mỗi giây, chunk-batch ACK, resource-pack ACK và client settings view distance 2.
- Microsoft auth, chat command có chữ ký, encryption, compression, configuration state, known packs và keepalive vẫn do `minecraft-protocol` xử lý.
- Mineflayer đầy đủ vẫn có thể chọn trong UI làm engine tương thích; việc đổi engine yêu cầu Stop profile.
- Network watchdog kiểm tra socket chết mỗi 15 giây và reconnect nếu không nhận packet trong 75 giây.
- BalanceTracker không còn đăng ký listener scoreboard khi `/balance` đang bật; map fallback được giới hạn 512 score/32 objective.
- FileLogger gom log 1 giây hoặc 32 KB rồi mới append; ProfileStore gom snapshot thống kê 10 giây.
- Headless giảm runtime state 30 giây và heartbeat worker 10 giây; cache whitelist, quét 1 giây và khóa Webhook chạy chồng.
- Đã kiểm thử 5 Protocol Max client độc lập và serialization thực của `settings`, `position_look`, `window_click`.
- `AutoSellController.js` giữ nguyên SHA-256 `4a2e242ad89f2b0a05ec60a3694fc53ec29c1379f4f1f1b11c264ada31a24e76`.

## Giao diện hướng dẫn Repair 11

- Sắp xếp màn hình chính theo luồng 3 bước: tạo profile, bắt đầu/kết nối, treo siêu nhẹ.
- Thêm khung “Việc cần làm tiếp theo” tự thay đổi theo trạng thái tài khoản.
- Đổi tên nút và mô tả sang tiếng Việt dễ hiểu; nhóm thao tác chính tại một vị trí.
- Làm lại cửa sổ Profile: tách thông tin bắt buộc, cấu hình khuyên dùng và tùy chọn nâng cao.
- Thêm hướng dẫn 4 bước trong ứng dụng và tự mở một lần cho người dùng mới.
- Gom thông tin kỹ thuật vào mục thu gọn, ưu tiên số dư và thống kê Auto Sell.
- Giữ nguyên hoàn toàn logic Auto Sell của Repair 10.

## Nguồn phục hồi

- Source ZCore 0.1.0 do chủ sở hữu cung cấp.
- Cấu trúc ASAR và dependency metadata còn lại trong ZCore Portable 0.2.2.
- Hành vi mạng và Auto Sell được đối chiếu với ZCore Android 0.2.6.

EXE 0.2.2 ban đầu bị thiếu 2.377.664 byte ở cuối `app.asar`, làm mất toàn bộ mã ứng dụng và 833 file dependency. Bản này dựng lại `app.asar` hoàn chỉnh từ dependency sạch.

## Kiểm tra

- 53/53 bài kiểm thử Node.js đạt.
- Toàn bộ JavaScript vượt qua `node --check`.
- ASAR chứa đủ entry point, Mineflayer và các module ZCore.
- EXE SFX vượt qua kiểm tra toàn vẹn 7-Zip.

## Sửa lỗi Repair 3

- Gửi `tick_end` ở 20 TPS theo protocol Minecraft 1.21.11 để tránh server kick `Invalid sequence`.
- Mỗi menu `/sell` chỉ được bấm xác nhận slot 53 đúng một lần; sau đó đóng menu và chờ chu kỳ kế tiếp.
- Timer kết nối 45 giây chỉ bắt đầu sau khi TCP đã kết nối, không còn cắt ngang lúc người dùng nhập mã Microsoft.

## Giao diện Repair 4

- Console có thanh cuộn lớn, có thể kéo lên/xuống và không bị dựng lại mỗi giây.
- Khi người dùng đang xem log cũ, log mới không tự kéo xuống; nút `Xuống cuối` bật lại chế độ theo dõi.
- Ô lệnh nằm ngay dưới console, hỗ trợ Enter hoặc nút `Gửi` và lịch sử lệnh bằng phím mũi tên lên/xuống.

## Giao diện và cấu hình Repair 5

- Tách cuộn console và cuộn toàn màn hình; màn hình ứng dụng có thể xuống tận đáy và trở lại đầu.
- Bánh xe chuột có thể chuyển từ console sang cuộn trang khi đã chạm đầu/cuối log.
- Thêm `Delay sau mỗi lần Auto Sell` từ 0,5–300 giây.
- Thêm `Gửi báo cáo Webhook mỗi` từ 1–1440 phút; thay đổi có hiệu lực ngay khi bot online.

## Tối ưu nhiều account Repair 6

- Mineflayer và phiên bot của từng profile được chuyển sang worker thread riêng.
- Main process chỉ giữ snapshot gọn; state không chứa lịch sử log và không còn phát lại toàn bộ profile mỗi giây.
- Log IPC được gom theo lô 100 ms, cache giao diện giới hạn 300 dòng và DOM chỉ nối thêm dòng mới.
- File log dùng hàng đợi bất đồng bộ thay cho `appendFileSync`; thống kê profile được debounce 750 ms.
- Số dư hiện tại được đọc thụ động từ scoreboard/actionbar/chat, không tự gửi `/balance` nên không gây thêm spam hay delay.
- `AutoSellController.js` giữ nguyên SHA-256 `4a2e242ad89f2b0a05ec60a3694fc53ec29c1379f4f1f1b11c264ada31a24e76` của Repair 5.

## Worker và số dư Repair 7

- Mỗi profile có setting `workerEnabled`; mặc định `true`, có thể tắt sau khi Stop profile.
- BotManager hỗ trợ cả worker thread lẫn BotSession trực tiếp mà không tạo hai phiên đồng thời.
- BalanceTracker bắt trực tiếp packet `scoreboard_objective`, `scoreboard_display_objective`, `scoreboard_score` và `reset_score` của Minecraft 1.21.11.
- Ưu tiên objective vị trí `below-name` và score của đúng username; đọc được raw value hoặc fixed number-format dạng `$670M`.
- Poll số dư mỗi 5.000 ms; sidebar/actionbar/chat vẫn là fallback.

## Số dư và thống kê Repair 8

- Mỗi profile có setting `balanceCommandEnabled`, mặc định bật; bot gửi `/balance` sau khi online 2 giây rồi lặp mỗi 30.000 ms.
- BalanceTracker nhận đúng phản hồi `You have $80,055,020`; scoreboard/sidebar vẫn được giữ làm fallback.
- StatsTracker chỉ nhận thông báo tiền trong cửa sổ 12 giây sau một lần Auto Sell đã bấm slot 53.
- Mỗi mã lượt bán chỉ được cộng một lần, tránh cùng một giao dịch xuất hiện ở cả chat và actionbar bị nhân đôi.
- Dòng Balance/Money/Cash/Wallet, `/pay`, paid, sent, received và transferred không được cộng vào số lượt bán hoặc thu nhập.
- `AutoSellController.js` vẫn giữ nguyên SHA-256 `4a2e242ad89f2b0a05ec60a3694fc53ec29c1379f4f1f1b11c264ada31a24e76`.

## Tối ưu 3–5 account Repair 9

- Mỗi account tiếp tục dùng worker thread riêng; test cả 5 worker thật và mô phỏng lỗi xác nhận một worker không đổi trạng thái bốn worker còn lại.
- BotManager giãn thời điểm Start 2.000 ms giữa các account; BotSession thêm offset ổn định theo profile cho reconnect, `/balance` và Webhook.
- BotWorker gửi heartbeat/heap mỗi 5.000 ms. BotManager kiểm tra mỗi 5.000 ms, chỉ phục hồi worker sau hai lần quá hạn 30.000 ms để tránh false-positive khi máy vừa thức dậy.
- Stop profile đóng session, flush log và terminate worker. Nếu worker không phản hồi lệnh Stop, manager buộc terminate để trả RAM.
- `BalanceTracker.attach(..., { pollScoreboard: false })` được dùng khi `/balance` bật; dòng chat `You have $80,055,020` được ghi nguồn `balance-command` và đẩy lên runtime người dùng.
- Runtime heartbeat giảm còn 2.000 ms; bảo vệ 500 ms chỉ tạo timer khi có ít nhất một chế độ bảo vệ bật.
- Cache log trong BotSession, BotManager và renderer giảm từ 300 xuống 150 dòng; file log bất đồng bộ không bị cắt.
- Renderer bật `backgroundThrottling` khi thu nhỏ và chỉ dựng lại phần chi tiết của profile đang chọn.
- `AutoSellController.js` vẫn giữ nguyên SHA-256 `4a2e242ad89f2b0a05ec60a3694fc53ec29c1379f4f1f1b11c264ada31a24e76`.

## AFK Max Repair 10

- `afkLiteEnabled` mặc định true và là trường kết nối: chỉ thay đổi sau khi Stop profile.
- Mineflayer nhận `physicsEnabled=false`, `viewDistance=2`, `maxCatchupTicks=1`, `defaultChatPatterns=false` và `colorsEnabled=false`; chat system `messagestr` cho `/balance` vẫn hoạt động.
- Worker dùng `resourceLimits.maxOldGenerationSizeMb=128`; health hiển thị cảnh báo khi heap vượt 85% giới hạn.
- BotWorker bỏ state trùng, gửi heartbeat state ổn định mỗi 10.000 ms và heartbeat sức khỏe mỗi 5.000 ms.
- BotSession state nền giảm còn 5.000 ms, cache log 100 dòng và rate-limit log actionbar 2.000 ms; parser số dư/thống kê không bị rate-limit.
- Chế độ headless phá hủy BrowserWindow/renderer thật, giữ app bằng Tray và báo toàn bộ worker tạm ngừng log chat/actionbar cùng state Auto Sell không thiết yếu.
- Khi mở lại UI, BotManager khôi phục realtime cho mọi worker. Worker tự phục hồi được tạo trong lúc headless cũng kế thừa chế độ tiết kiệm.
- Kiểm thử tạo năm worker thật với heap limit, heartbeat và shutdown độc lập.
- `AutoSellController.js` vẫn giữ nguyên SHA-256 `4a2e242ad89f2b0a05ec60a3694fc53ec29c1379f4f1f1b11c264ada31a24e76`.

## Lưu ý

File chưa có chữ ký code-signing nên Windows SmartScreen hoặc phần mềm antivirus có thể cảnh báo. Microsoft Device Code và token được lưu cục bộ theo profile; không chia sẻ thư mục dữ liệu của ZCore.
