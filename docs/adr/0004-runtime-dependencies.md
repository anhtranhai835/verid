# ADR-0004: Phụ thuộc runtime tối thiểu

- Trạng thái: Accepted, 2026-10-19

## Bối cảnh
Cần validate payload của hook, đọc `manifest.yaml` và parse JUnit XML. Tự viết parser XML dễ sai, nhất là ở phần entity và escape.

## Quyết định
Chỉ dùng 3 thư viện runtime:
- `zod`: validate payload và schema.
- `yaml`: đọc manifest.
- `fast-xml-parser`: đọc JUnit.

## Lựa chọn thay thế
Không dùng thư viện nào, tự viết type guard và parser. Rủi ro sai ở chính phần kiểm chứng bằng chứng.

## Hệ quả
Muốn thêm thư viện nào khác thì phải có ADR mới.
