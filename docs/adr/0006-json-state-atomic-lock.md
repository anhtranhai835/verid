# ADR-0006: State lưu bằng JSON, ghi atomic, có lockfile

- Trạng thái: Accepted, 2026-10-19

## Bối cảnh
Claude Code có thể chạy nhiều hook song song. Bộ đếm phải còn nguyên sau khi restart, và không được mất lần ghi nào.

## Quyết định
- `state.json` ghi atomic: ghi ra file tạm rồi rename.
- Lockfile tạo theo kiểu độc quyền (`open` với cờ `wx`), có timeout và xử lý lock bị bỏ lại.
- Có `schemaVersion`.
- Có test chạy đồng thời.

## Lựa chọn thay thế
SQLite: có transaction sẵn, nhưng khó đọc và khó debug bằng mắt, đồng thời thêm một phụ thuộc native.

## Hệ quả
- Phải tự xử lý lock bị bỏ lại trên Windows.
- Khi hết thời gian chờ lock thì fail-closed.
