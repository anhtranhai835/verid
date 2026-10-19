# ADR-0003: Node.js 22 LTS, build TypeScript sang JavaScript

- Trạng thái: Accepted, 2026-10-19

## Bối cảnh
Hook chạy ở mỗi lần gọi tool, và verid sẽ phát hành open-source. haren dùng Bun.

## Quyết định
- Yêu cầu Node.js ≥22 LTS.
- Build TypeScript ra `dist/`. Hook chạy bằng `node dist/hook.js`.

## Lựa chọn thay thế
Bun, chạy thẳng file `.ts`: khởi động nhanh hơn, nhưng ít phổ biến hơn, và người dùng phải cài thêm runtime.

## Hệ quả
- Cần bước build trước khi chạy.
- Phải đo thời gian khởi động hook ở Phase 0.
- Vitest dùng làm test runner (C3).
