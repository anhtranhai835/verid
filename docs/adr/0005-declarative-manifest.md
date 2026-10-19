# ADR-0005: manifest.yaml chỉ khai báo, không chạy code

- Trạng thái: Accepted, 2026-10-19

## Bối cảnh
Probity dùng `probity.config.ts`: lập trình được, nhưng hook phải chạy code lấy từ repo. Điều này mở thêm bề mặt tấn công.

## Quyết định
- Cấu hình nằm trong `<verid>/manifest.yaml`, có `schemaVersion` và được validate bằng zod.
- Hook bảo vệ file này: agent không được sửa.

## Lựa chọn thay thế
File config viết bằng TypeScript.

## Hệ quả
Muốn mở rộng rule bằng code thì sau này phải có cơ chế riêng, được kiểm soát.
