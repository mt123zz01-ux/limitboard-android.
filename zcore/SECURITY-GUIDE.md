# Gợi ý bảo vệ ZCore tránh leak/crack

Không có EXE hoặc JAR chạy trên máy khách nào chống crack tuyệt đối. Mục tiêu đúng là không đặt bí mật quan trọng trong file phát cho khách, tăng chi phí chỉnh sửa và có khả năng khóa hoặc truy ra bản bị leak.

## Kiến trúc nên dùng

1. Website quản lý key lưu key dưới dạng hash, không lưu key rõ.
2. Khi mở ZCore, client gửi license key, mã thiết bị và phiên bản ứng dụng tới API qua HTTPS.
3. API kiểm tra hạn dùng, số thiết bị, trạng thái khóa và phiên bản tối thiểu.
4. API trả về giấy phép ngắn hạn được ký số, ví dụ 6–24 giờ.
5. ZCore chỉ chứa public key để kiểm chữ ký; private key luôn nằm trên server.
6. Khi mất mạng, chỉ cho phép dùng giấy phép đã ký trong một khoảng ngắn. Không cấp quyền offline vĩnh viễn.

## Các lớp bảo vệ nên triển khai

- Mỗi khách nhận một `customerBuildId` hoặc watermark riêng để truy nguồn bản leak.
- Có chức năng khóa key, reset thiết bị, giới hạn số máy và buộc phiên bản tối thiểu.
- Ký code EXE để giảm cảnh báo SmartScreen và xác minh file phát hành chính chủ.
- Bật ASAR integrity và Electron fuses phù hợp khi build.
- Obfuscate phần JavaScript phát hành để tăng thời gian phân tích, nhưng giữ source gốc không obfuscate để bảo trì.
- Không nhúng database password, private signing key, master API key hoặc webhook quản trị trong EXE.
- API áp dụng rate limit, log đăng nhập bất thường và phát hiện một key dùng từ nhiều thiết bị/IP trong thời gian ngắn.

## Không nên dựa vào

- Chỉ kiểm tra HWID ở phía client: người crack có thể xóa nhánh kiểm tra.
- Chỉ obfuscate hoặc đóng gói ASAR: vẫn có thể giải nén và vá.
- Hard-code một secret chung trong EXE: secret sẽ bị lấy và dùng để giả license.
- Chặn Task Manager, anti-debug phá máy hoặc xóa file người dùng: dễ gây báo virus và không tăng bảo mật thực tế.

## Thứ tự làm với ngân sách nhỏ

1. API license tối giản và trang admin tạo/khóa/reset key.
2. Token giấy phép ngắn hạn ký Ed25519.
3. Watermark riêng theo khách và nhật ký kích hoạt.
4. Code signing khi bắt đầu bán rộng.
5. Obfuscation ở bước build cuối cùng.

Phần cần bảo vệ nhất nên chuyển dần lên server. Obfuscation và HWID chỉ là lớp phụ, không phải lớp bảo mật chính.
