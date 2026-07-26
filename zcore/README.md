# ZCore 0.2.4 Repair 22

ZCore là client treo Minecraft Java 1.21.11 dành cho Windows. Ứng dụng đăng nhập tài khoản Microsoft bằng Device Code, hỗ trợ nhiều profile và chạy Auto Sell theo đúng luồng của file `Bùa Lỗ Ban.txt`.

## Mới trong Repair 22 — nhẹ hết mức và bố cục GUI mới

- Tắt hẳn tăng tốc phần cứng Electron: giao diện chỉ là DOM tĩnh nên GPU process không mang lại gì, bỏ nó là bỏ trọn một process.
- Bộ lọc packet mở rộng: 110/139 packet PLAY bị bỏ trước bước decode với cấu hình mặc định (Repair 21 là 83/139).
- Packet người chơi chỉ được decode khi bật Whitelist Guard hoặc cảnh báo người lạ.
- Đo thực tế 5 account: RAM giảm từ 101,9 MB xuống 78,0 MB (20,4 → 15,6 MB mỗi account).
- Bố cục mới lấp đúng viewport, Start/Dừng/Treo siêu nhẹ lên topbar, ô lệnh gộp vào console, cột thống kê gọn lại.
- Bỏ toàn bộ hiệu ứng blur — sau khi tắt GPU, blur do CPU vẽ lại từng khung hình.
- Sửa lỗi thiếu listener `sync_entity_position` khiến Whitelist Guard đọc sai vị trí người lạ sau khi họ teleport.
- `AutoSellController.js`, `AutoSellAxeController.js` và `AutoHomeController.js` giữ nguyên byte-for-byte.
- 124/124 bài kiểm thử tự động đạt.

## Mới trong Repair 21

- Thêm module **AutoSellAxe Member**. Bật module này sẽ tự tắt Auto Sell thường; bật Auto Sell thường sẽ tự tắt AutoSellAxe.
- AutoSellAxe gửi packet chuột trái mỗi 100 ms, không phụ thuộc cửa sổ GUI nên vẫn hoạt động khi inventory hoặc GUI khác đang mở.
- Khi mất kết nối, setting vẫn được giữ; sau khi reconnect và vào server thành công, AutoSellAxe tự giữ chuột trái trở lại.
- Có công tắc **Tự nhìn thẳng lên trời**. Khi bật, ZCore kiểm tra mỗi 5 phút và chỉ gửi góc nhìn `-90°` nếu nhân vật chưa nhìn thẳng lên.
- Protocol Max gửi trực tiếp `arm_animation` và `look`; Mineflayer dùng API tương thích của engine.
- Giao diện có công tắc nhanh, setting riêng và trạng thái đang giữ chuột trái.
- 118/118 bài kiểm thử tự động đạt.

## Mới trong Repair 20

- Cấu hình khuyên dùng được tăng tốc: quét túi 0,10–0,20 giây; nghỉ giữa nhóm quickAll 0,05–0,10 giây; chờ server 0,25–0,40 giây; vòng bán tiếp theo 0,15–0,30 giây.
- Random delay vòng bán được bật mặc định. GUI timeout giữ 3 giây, cooldown lỗi 1 giây và nhịp xử lý 50 ms.
- Cho phép chỉnh toàn bộ delay Auto Sell ngay trong profile: vòng cố định hoặc random Min–Max, quét túi, quickAll, chờ server, timeout GUI, cooldown lỗi và nhịp xử lý.
- Các cặp Min–Max nhập ngược được tự sắp xếp; mọi delay theo giây được giới hạn 0,05–60 giây và nhịp xử lý 20–1.000 ms.
- Giữ nguyên luồng `/sell` → chờ GUI 90 slot → quickAll → chờ server → đóng đúng GUI → lặp; không đổi Webhook, xử lý người lạ, Auto Home hoặc sao chép profile.
- 108/108 bài kiểm thử tự động đạt.

## Mới trong Repair 19

- Discord Webhook có công tắc riêng cho báo cáo định kỳ, nhân vật chết, người lạ, không sell và OFFLINE.
- Cảnh báo không sell dùng số phút tùy chỉnh, chỉ chạy khi bot ONLINE và Auto Sell đang bật; một lượt sell hoàn tất sẽ đặt lại bộ đếm.
- Có thể nhập Discord User ID để ZCore tag đúng người trong cảnh báo.
- Khi người lạ vào bán kính, có thể chọn tiếp tục sell, tạm dừng Auto Sell đến khi họ rời đi, hoặc thoát game và không reconnect.
- Nút **Sao chép** giữ toàn bộ setting của profile nguồn nhưng tạo ID/token riêng, xóa email và đặt lại thống kê để đăng nhập account mới an toàn.
- Logic lõi `AutoSellController.js` không thay đổi so với Repair 18.1.

## Hotfix Repair 18.1 — Finish Setup

- Sửa lỗi trang Finish cố mở shortcut `ZCore.lnk` và Windows báo không có ứng dụng liên kết.
- Nút Finish luôn chạy trực tiếp `ZCore.exe` đã cài, không còn phụ thuộc file association của `.lnk`.
- Shortcut Desktop và Start Menu vẫn được tạo như cũ.
- Không thay đổi Microsoft Auth, reconnect, Auto Sell, Auto Home hoặc dữ liệu profile của Repair 18.

## Thay đổi trong bản Repair 18 — Microsoft Auth và reconnect

- Sửa nguyên nhân thông báo sai `Failed to obtain profile data ... does the account own minecraft?`: ZCore tự lấy profile và giữ lại đúng lỗi HTTP/mạng thay vì để thư viện gom mọi lỗi thành “chưa mua game”.
- Chỉ kết luận tài khoản không có Minecraft Java khi endpoint profile trả về đúng HTTP 404. Lỗi `fetch failed`, timeout, DNS, HTTP 5xx và auth server gián đoạn được xem là lỗi tạm thời.
- Nếu Minecraft trả HTTP 401, ZCore làm mới Minecraft access token đúng một lần rồi thử lấy profile lại.
- Lỗi xác thực xảy ra trước khi mở TCP nay được giải phóng ngay và đưa vào lịch reconnect; không còn đứng mãi ở trạng thái RECONNECT vì thiếu sự kiện `end`.
- Giữ nguyên cache Microsoft khi dịch vụ lỗi. Nhịp thử auth riêng là 30, 60, 120, 240 rồi tối đa 300 giây, cộng offset 0–8 giây theo profile để nhiều account không gọi auth cùng lúc.
- Cờ network watchdog được đặt lại ở mỗi phiên kết nối để một account vẫn tiếp tục phát hiện socket im lặng sau nhiều lần reconnect.
- Không thay đổi logic Auto Sell, random delay, Auto Home, Protocol Max hoặc cấu hình profile của Repair 17.
- Bộ kiểm thử hiện có 92/92 bài đạt, gồm mô phỏng HTTP 401, 404, `fetch failed`, lỗi trước TCP và toàn bộ luồng cũ.

## Thay đổi trong bản Repair 1

- Khôi phục source từ v0.1.0 và phần metadata còn lại trong EXE v0.2.2 bị cắt.
- Bật TCP keep-alive và TCP no-delay tương tự bản Android 0.2.6.
- Bỏ qua sự kiện ngắt của phiên kết nối cũ để tránh reconnect chồng nhau.
- Tự reconnect theo nhịp 10, 20, 40 rồi tối đa 60 giây khi lỗi liên tiếp.
- Timeout phiên không vào được server sau 45 giây và thử lại có kiểm soát.
- Ghi log mạng ra file, gồm uptime, số packet và thời điểm nhận packet cuối.
- Hỗ trợ HTTP CONNECT và SOCKS5 proxy, có hoặc không có xác thực.
- Chặn mở nhiều instance ZCore cùng lúc để tránh một tài khoản bị kết nối hai lần.

## Thay đổi trong bản Repair 2

- Sửa console bị mất vị trí cuộn khi trạng thái bot cập nhật mỗi giây.
- Cho phép cuộn bằng chuột ổn định và thêm nút `Xuống cuối`.

## Thay đổi trong bản Repair 3

- Bổ sung `tick_end` 20 TPS còn thiếu trong luồng Mineflayer 1.21.11 để xử lý lỗi DonutSMP kick `Invalid sequence`.
- Khóa thao tác xác nhận: một menu sell chỉ bấm slot 53 một lần, không còn lặp ba lần trong chưa tới một giây.
- Sau khi bán, đóng menu có kiểm soát và chờ 1,5 giây trước chu kỳ mới.
- Không tính thời gian chờ người dùng xác thực Microsoft vào timeout kết nối server 45 giây.

## Thay đổi trong bản Repair 4

- Thanh cuộn console hiển thị rõ và kéo trực tiếp lên/xuống ổn định.
- Giữ vị trí khi đọc log cũ; chỉ tự cuộn khi đang ở cuối console.
- Ô nhập lệnh/chat ngay dưới console gửi trực tiếp vào game, ví dụ `/pay user 1000`.
- Enter để gửi; phím mũi tên lên/xuống gọi lại tối đa 50 lệnh gần nhất.

## Thay đổi trong bản Repair 5

- Console và toàn màn hình có hai thanh cuộn độc lập, đều kéo được lên đầu/xuống cuối.
- Trong Cài đặt có delay giữa các chu kỳ Auto Sell, đơn vị giây.
- Trong Cài đặt Discord có chu kỳ gửi báo cáo Webhook, đơn vị phút.

## Thay đổi trong bản Repair 6

- Mỗi profile chạy trong một worker độc lập; một account bị chậm không còn chặn giao diện hoặc các account khác.
- Ghi log file bất đồng bộ, gửi log lên giao diện theo lô và chỉ cập nhật profile thay đổi thay vì dựng lại toàn bộ danh sách mỗi giây.
- Console giữ tối đa 300 dòng gần nhất trên giao diện; file log trên ổ đĩa vẫn lưu đầy đủ.
- Thống kê được gom và lưu theo nhịp để giảm ghi đĩa khi treo nhiều account.
- Thêm thẻ `Số tiền hiện có`, tự nhận từ scoreboard, actionbar hoặc chat khi server gửi dòng Balance/Money/Cash/Wallet/Số dư.
- Logic `AutoSellController` được giữ nguyên byte-for-byte so với Repair 5.

## Thay đổi trong bản Repair 7

- Thêm setting `Chia worker riêng` cho từng profile, mặc định bật và chỉ đổi được khi profile đã Stop.
- Khi tắt worker, profile chạy trực tiếp trong main process để có thể so sánh; khi bật, profile tiếp tục được cô lập trong worker riêng.
- Luôn hiển thị thẻ `Số tiền hiện có`, mặc định `$0` trong lúc chờ dữ liệu.
- Đọc trực tiếp scoreboard `below-name` của đúng tài khoản, gồm dạng rút gọn như `$670M`, và cập nhật mỗi 5 giây.
- Vẫn giữ nhận diện Balance/Money/Cash/Wallet/Số dư từ sidebar, actionbar và chat làm dự phòng.
- Logic `AutoSellController` tiếp tục giữ nguyên byte-for-byte.

## Thay đổi trong bản Repair 8

- Thêm setting `Tự gửi /balance mỗi 30 giây` cho từng profile, mặc định bật và có thể đổi ngay khi bot đang online.
- Đọc phản hồi số dư dạng `You have $80,055,020` và luôn hiển thị ở thẻ `Số tiền hiện có`.
- Chỉ ghi nhận thu nhập khi vừa có một lần bấm xác nhận Auto Sell; một lần xác nhận chỉ được cộng tối đa một lần.
- Loại thông báo `/balance`, `/pay`, gửi/nhận/chuyển tiền khỏi `Lần sell`, `Đã kiếm phiên này` và `Thu nhập trung bình`.
- Logic `AutoSellController` tiếp tục giữ nguyên byte-for-byte.

## Thay đổi trong bản Repair 9

- Tối ưu mục tiêu chạy ổn định 3–5 account: mỗi account vẫn được cách ly trong worker riêng.
- Khởi động account, reconnect, `/balance` và Webhook được giãn thời điểm để tránh dồn CPU/mạng cùng lúc.
- Worker phát heartbeat mỗi 5 giây; nếu một worker treo, ZCore chỉ phục hồi account đó mà không tác động account khác.
- Bấm Stop sẽ giải phóng hoàn toàn worker và heap của account; giao diện hiển thị heap từng worker để theo dõi.
- Khi tự gửi `/balance` đang bật, bỏ vòng poll scoreboard cũ; phản hồi chat dạng `You have $80,055,020` cập nhật trực tiếp `Số tiền hiện có`.
- Timer bảo vệ chỉ chạy khi bật Bảo vệ vị trí hoặc Whitelist Guard; Webhook chỉ tạo timer khi được cấu hình đầy đủ.
- State giao diện giảm từ mỗi 1 giây xuống 2 giây, cache console trong RAM giảm còn 150 dòng; file log vẫn lưu đầy đủ.
- Giao diện Electron được phép giảm hoạt động khi thu nhỏ; bot, tick protocol và Auto Sell vẫn chạy trong worker.
- Logic `AutoSellController` tiếp tục giữ nguyên byte-for-byte.

## Thay đổi trong bản Repair 10 — AFK Max

- Thêm `AFK Max` mặc định bật theo profile: tắt mô phỏng physics, giới hạn view distance còn 2 chunk, giảm catch-up tick và bỏ chat pattern không dùng.
- Mỗi worker được giới hạn old-generation heap 128 MB để ngăn một account rò RAM làm cạn toàn bộ máy.
- Runtime state ổn định chỉ gửi heartbeat mỗi 10 giây; thay đổi quan trọng, sell, lỗi và disconnect vẫn gửi ngay.
- Cache console trong RAM giảm còn 100 dòng. Actionbar chỉ log tối đa mỗi 2 giây trong AFK Max; nhận diện tiền và Auto Sell vẫn xử lý mọi message.
- Thêm nút `Treo siêu nhẹ`: đóng hoàn toàn renderer Electron, tạm ngừng chat/actionbar và state Auto Sell không thiết yếu, bot tiếp tục chạy dưới khay hệ thống.
- Nhấp đúp biểu tượng ZCore ở khay để mở lại giao diện; chọn `Dừng bot và thoát` để kết thúc toàn bộ worker.
- `/balance`, heartbeat worker, tick protocol 1.21.11, inventory và logic Auto Sell vẫn hoạt động khi treo nền.
- Logic `AutoSellController` tiếp tục giữ nguyên byte-for-byte.

## Thay đổi trong bản Repair 11 — Giao diện dễ sử dụng

- Màn hình chính hướng dẫn theo ba bước: tạo profile, kết nối và treo siêu nhẹ.
- Khung “Việc cần làm tiếp theo” tự đổi nội dung theo trạng thái tài khoản.
- Cửa sổ cài đặt phân biệt rõ phần bắt buộc, cấu hình khuyên dùng và tùy chọn nâng cao.
- Thêm hướng dẫn bốn bước ngay trong ứng dụng; tự hiển thị một lần khi chưa có profile.
- Ưu tiên số dư và thống kê Auto Sell; thông tin kỹ thuật được gom vào mục thu gọn.
- Các nút chính có tên tiếng Việt và mô tả ngắn để người dùng mới biết tác dụng.
- Logic `AutoSellController` vẫn giữ nguyên byte-for-byte so với Repair 10.

## Thay đổi trong bản Repair 12 — Protocol Max

- Thêm engine `Protocol Max` làm mặc định: bỏ toàn bộ world/chunk cache, physics, mob, particle, sound và plugin Mineflayer không dùng.
- Chỉ giữ các phần cần cho bot: Microsoft auth, proxy, chat/lệnh, inventory, GUI Sell, keepalive, position tối thiểu, người chơi cho Whitelist Guard và `tick_end`.
- GUI Sell tiếp tục dùng state ID, window ID, slot update và click packet Minecraft 1.21.11; logic `AutoSellController` không bị sửa.
- Giữ engine `Mineflayer` trong Cài đặt làm chế độ tương thích cho server đặc biệt.
- `/balance` là nguồn số dư chính; listener và map scoreboard chỉ được tạo khi người dùng tắt `/balance` và cần fallback.
- Log file được gom thành lô 1 giây/32 KB; thống kê được gom 10 giây để giảm thao tác ổ đĩa.
- Chế độ Treo siêu nhẹ giảm runtime state còn 30 giây và heartbeat worker còn 10 giây; reconnect, Auto Sell và tick protocol vẫn chạy bình thường.
- Thêm network watchdog: nếu socket không nhận bất kỳ packet nào trong 75 giây, ZCore chủ động đóng phiên chết và reconnect.
- Whitelist được cache sẵn, quét bảo vệ giảm còn 1 lần/giây và Webhook không thể chạy chồng.
- Đã kiểm thử đồng thời 5 Protocol Max client, GUI slot 53, packet serialize, worker isolation, reconnect và bảo toàn Auto Sell.
- SHA-256 `AutoSellController.js`: `4a2e242ad89f2b0a05ec60a3694fc53ec29c1379f4f1f1b11c264ada31a24e76`.

## Thay đổi trong bản Repair 13 — `/balance` chính xác

- Thay cửa sổ đọc tiền chung 15 giây bằng trạng thái request–response riêng cho từng account.
- Chỉ nhận phản hồi số dư đúng mẫu như `You have $80,055,020`, `Your balance is $1.25B`, `Balance: 670M` hoặc `Số dư của bạn: 1.234.567đ`.
- Từ chối dòng `/pay`, nhận/chuyển tiền, Auto Sell và chat người chơi ngay cả khi chúng xuất hiện trong lúc đang chờ `/balance`.
- Lệnh `/balance` do member tự nhập trong console cũng được theo dõi giống lệnh tự động.
- Hiển thị rõ trạng thái đang chờ, timeout, lỗi gửi và thời gian cập nhật gần nhất; giữ số dư cũ nếu server chưa trả lời.
- Thêm nút `Cập nhật ngay`; chế độ tự động vẫn bật/tắt được và mặc định gửi mỗi 30 giây.
- `AutoSellController.js` tiếp tục giữ nguyên SHA-256 `4a2e242ad89f2b0a05ec60a3694fc53ec29c1379f4f1f1b11c264ada31a24e76`.

## Thay đổi trong bản Repair 14 — Auto Sell liên tục

- Bỏ điều kiện chờ inventory gần đầy. Sau khi bật, controller chờ mặc định 20 tick rồi gửi `/sell`.
- GUI bán được giữ mở và kiểm tra liên tục; vật phẩm mới xuất hiện sẽ được chuyển ngay mà không cần chờ đầy túi.
- Sau khi vùng 0–44 đầy, controller chờ ngẫu nhiên rồi bấm slot 53 đúng một lần cho mỗi Window ID.
- Sau khi bán, controller đóng đúng GUI của phiên hiện tại, nghỉ ngẫu nhiên Min–Max và tự bắt đầu lượt `/sell` tiếp theo.
- Có khoảng Min–Max riêng cho delay chuyển đồ, delay chu kỳ và số stack mỗi nhịp; mỗi hành động lấy lại một giá trị ngẫu nhiên.
- Nếu click lỗi, controller ghi log, đóng phiên lỗi, nghỉ 20 tick (1 giây) và tự phục hồi.
- GUI không đúng bố cục tối thiểu 54 slot bị từ chối; GUI treo quá 5 phút được đóng và mở lại.
- BotSession chỉ đánh dấu lượt bán khi controller thật sự click slot 53 thành công và chuyển sang `WAITING_AFTER_SELL`.
- Giao diện Cài đặt có thẻ “Nhịp Auto Sell” trực quan, giải thích Min–Max, tick, giây và luồng `/sell → Chuyển đồ → Slot 53 → Lặp lại`.
- Thiết lập Repair 13 cũ được tự chuyển sang cấu trúc Min–Max khi đọc profile.
- Bộ kiểm thử tăng lên 60 bài và bao phủ chu kỳ liên tục, lỗi click, GUI sai, random delay và migration profile.

## Thay đổi trong bản Repair 15 — Logic Bùa Lỗ Ban

- Thay toàn bộ Auto Sell Repair 14 bằng luồng cố định của file `Bùa Lỗ Ban.txt`.
- Khi inventory trống, kiểm tra lại sau đúng 1 giây; chỉ cần có một vật phẩm trong 36 slot cuối là gửi `/sell` ngay.
- Chờ tối đa 5 giây và chỉ nhận GUI có tổng cộng đúng 90 slot.
- Duyệt slot 54–89, dùng `quickAll` cho từng ID vật phẩm; các stack giống cả item data/components được shift-click cùng lượt.
- Sau khi chuyển đồ, chờ đúng 1 giây, đóng GUI tương đương phím ESC, chờ thêm đúng 1 giây rồi lặp lại.
- Không click slot 53, không dọn slot 45–52 và không dùng delay ngẫu nhiên.
- Xóa toàn bộ thẻ chỉnh delay/số stack Auto Sell khỏi giao diện và loại bỏ `sellSettings` khỏi profile.
- Bộ kiểm thử hiện có 61/61 bài đạt, gồm packet quickAll mode 1, timeout 5 giây và chu kỳ đóng GUI.

## Thay đổi trong bản Repair 16 — Treo nhiều account siêu nhẹ

- Giữ nguyên luồng bán của Repair 15: có đồ → `/sell` → GUI 90 slot → `quickAll` → chờ 1 giây → ESC → lặp.
- Thêm `Delay Auto Sell` sau khi đóng GUI; có thể dùng một giá trị cố định hoặc bật random `Min → Max`. Các bước kiểm tra túi, timeout GUI và quickAll không đổi.
- Protocol Max bỏ packet world/render nặng ngay trước bước decode object, nhưng vẫn giữ đầy đủ login, configuration, encryption, compression, keepalive, chat ký số, inventory, GUI, position và resource pack để vào server bình thường.
- Chunk batch được nhận ở tốc độ 0,5 chunk/tick; các profile Start cách nhau 8 giây và reconnect có offset 8 giây để tránh CPU/mạng tăng cùng lúc.
- Chat/component chỉ chuyển thành text khi console, số dư hoặc thống kê thật sự cần.
- Thêm công tắc `Theo dõi số dư`; khi tắt, ZCore không gửi `/balance`, không poll scoreboard và bỏ xử lý text số dư. Packet scoreboard cũng chỉ decode khi dùng chế độ fallback.
- Khi mọi profile đều ONLINE, ZCore báo trước 15 giây rồi tự chuyển sang Treo siêu nhẹ. Nếu đang mở cửa sổ cài đặt/xác thực, tác vụ chờ đến khi đóng hộp thoại.
- Worker gom state/log IPC theo lô lớn hơn, không giữ thêm bản sao cache log trong worker và chỉ cập nhật heap giao diện định kỳ.
- Snapshot thống kê của nhiều account được gom để ghi `profiles.json` một lần; log file được gom 2 giây/64 KB.
- Worker riêng, theo dõi người chơi, Whitelist Guard và logic clickWindow được giữ nguyên theo lựa chọn tối ưu.

## Thay đổi trong bản Repair 17 — Auto Sell Random và Auto Home

- Thời gian kiểm tra lại khi túi trống mặc định random `0,5–0,8 giây`; có thể chỉnh riêng Min và Max trong từng profile.
- Timeout chờ GUI `/sell` giảm còn đúng 3 giây. Khi timeout, bot nghỉ theo Min–Max kiểm tra túi rồi mới thử lại và không đóng nhầm cửa sổ khác.
- Giữa các nhóm `quickAll` có delay random `0,05–0,15 giây`; sau khi chuyển đồ, bot chờ random `0,5–0,7 giây` rồi đóng đúng GUI Sell.
- Delay sau khi đóng GUI vẫn chỉnh được theo một giá trị cố định hoặc random `Min → Max` như Repair 16.
- Thêm Auto Home bật/tắt theo profile, chọn số Home 1–4 và chu kỳ gửi theo phút. Bot gửi đúng lệnh `/home <số>`.
- Auto Home bắt đầu đếm khi tài khoản ONLINE. Nếu đến giờ mà Auto Sell đang dùng GUI, lệnh Home chờ GUI đóng; sau khi gửi, Auto Sell tạm nghỉ 3 giây rồi tiếp tục.
- Cài đặt Auto Home có hiệu lực ngay khi bot đang ONLINE; đổi số Home hoặc delay sẽ bắt đầu lại chu kỳ từ lúc lưu.
- Bộ kiểm thử hiện có 85/85 bài đạt, gồm Auto Home, xung đột GUI Sell, timer worker, Protocol Max và toàn bộ luồng Repair 16.

## Tính năng hiện có

- Đăng nhập Microsoft Device Code; ZCore không yêu cầu nhập mật khẩu Microsoft.
- Mỗi profile có vùng cache xác thực riêng.
- Chạy nhiều profile đồng thời, mỗi profile có worker riêng.
- `Protocol Max` mặc định cho 3–5 account; có thể chọn `Mineflayer` tương thích sau khi Stop profile.
- Server và port tùy chọn, giao thức Minecraft 1.21.11.
- Console chat có thể bật hoặc tắt; ô nhập chỉ gửi lệnh/chat vào Minecraft.
- Auto Sell: có đồ thì gửi `/sell`, chờ GUI 90 slot, `quickAll` inventory 54–89, chờ random 0,5–0,7 giây rồi đóng GUI.
- Khi túi trống, Auto Sell kiểm tra lại theo random Min–Max mặc định 0,5–0,8 giây; khi GUI không mở sau 3 giây, vòng lặp trở về bước kiểm tra túi có delay.
- Có thể chỉnh thời gian nghỉ sau mỗi lượt Auto Sell theo delay cố định hoặc random Min–Max; không có chỉnh slot, batch hay logic quickAll.
- Auto Home có thể bật/tắt, chọn Home 1–4 và đặt chu kỳ gửi `/home <số>` từ 1–1440 phút.
- Tự reconnect, thống kê tiền bán có đối chiếu lượt Auto Sell, tự kiểm tra số dư bằng `/balance` và báo cáo Discord theo chu kỳ cấu hình.
- Tùy chọn dừng khi lệch vị trí và ngắt kết nối khi gặp người ngoài whitelist.
- Dữ liệu profile và thống kê được lưu cục bộ trong thư mục dữ liệu ứng dụng.
- Khi xóa profile, ZCore cũng xóa vùng cache đăng nhập Microsoft tương ứng trên máy.

## Chạy source

Yêu cầu Node.js 22 trở lên.

```bash
npm install
npm start
```

## Kiểm thử

```bash
npm test
```

## Xuất ứng dụng Windows

Chạy trên Windows 64-bit:

```powershell
npm install
npm run dist:win
```

Setup được tạo tại `dist/setup`, Portable tại `dist/portable`. Hai target được build tuần tự trong thư mục riêng để không dùng chung hoặc ghi đè payload. Bản chưa ký số có thể bị Windows SmartScreen cảnh báo; phát hành công khai nên ký code bằng chứng thư phù hợp.

## Cách đăng nhập

1. Tạo profile, nhập tên, server và một định danh cho tài khoản Microsoft.
2. Nhấn Start.
3. Khi ZCore hiện Device Code, mở trang Microsoft và nhập mã.
4. Token do thư viện xác thực Minecraft cache trong thư mục riêng của profile; mật khẩu không đi qua giao diện ZCore.

Không chia sẻ thư mục dữ liệu ZCore vì cache đăng nhập là dữ liệu nhạy cảm. Bản đầu chưa mã hóa cache bằng Windows DPAPI.

## Lưu ý Auto Sell

Logic Repair 18 vẫn phụ thuộc lệnh `/sell` mở GUI có đúng 90 slot và inventory người chơi nằm tại slot 54–89. Tool không click nút xác nhận; nó `quickAll`, đóng GUI rồi lặp. Delay vòng lặp, Min–Max kiểm tra túi và Auto Home được lưu riêng theo từng profile. Hãy thử trước bằng một profile có ít vật phẩm nếu server thay đổi bố cục GUI.
