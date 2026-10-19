# ADR-0002: Functional Core, Imperative Shell

- Trạng thái: Accepted, 2026-10-19

## Bối cảnh
Policy, state machine và việc phân loại evidence phải test được bằng TDD. Tất cả I/O (stdin, fs, spawn, git) cần tách riêng khỏi phần logic này.

## Quyết định
- `core/` chỉ chứa hàm thuần. Không import `node:fs`, `node:child_process`, `node:net` hay `process`.
- `adapters/` thực hiện I/O và chuyển dữ liệu qua lại với `core`.
- Chiều phụ thuộc: `core ← adapters ← cli/hook`. Có một test kiểm tra danh sách import để giữ luật này.

## Lựa chọn thay thế
Kiểu class/OOP như TDD Guard: nhiều thủ tục hơn, và phải mock khi test.

## Hệ quả
Unit test cho `core` nhanh, không cần mock. Các adapter được kiểm bằng E2E chạy process thật.
