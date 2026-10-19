# verid: chuẩn code

Đã chốt ngày 2026-10-19. Xem thêm [system-architecture.md](system-architecture.md).

## C1. Code

- TypeScript `strict`, ESM, Prettier. Kiểm tra kiểu bằng `tsc --noEmit`. ESLint chưa dùng trong Phase 0.
- Tên file viết kebab-case. Chỉ dùng named export.
- Hạn chế class. Ưu tiên hàm thuần và kiểu dữ liệu rõ ràng.
- Comment giải thích *vì sao*, không lặp lại code.
- Khoảng 200 dòng mỗi file là mục tiêu mềm. Không chia file máy móc chỉ để đạt con số này.

## C2. Lỗi

```ts
type PolicyDecision =
  | { kind: "allow"; reason: string }
  | { kind: "deny"; code: ErrorCode; reason: string };
```

- Trong `core`: lỗi dự kiến được trả về dưới dạng giá trị, không `throw`.
- Adapter bắt mọi lỗi bất ngờ và chuyển thành `deny` với `VERID_E_INTERNAL`. Lỗi nội bộ không bao giờ được dẫn tới `allow`.
- Mã lỗi có dạng `VERID_E_<VÙNG>_<TÊN>` và cố định giữa các phiên bản. Mỗi mã có một key i18n trong cả `vi.json` lẫn `en.json`. Có test kiểm tra đủ key ở cả hai file.

## C3. Test

- Dùng Vitest cho unit test và test tích hợp.
- Unit test của `core` viết dạng bảng: input và expected đều là literal, không tính expected bằng chính code đang được test.
- E2E chạy **process thật**: spawn `node dist/hook.js`.
  - Fixture lấy từ payload Claude Code thật đã ghi lại ở Phase 0.
  - **Không chép logic của hook vào test** rồi kiểm tra bản chép đó.
- Hai lớp đều cần E2E: unit test chứng minh policy đúng, nhưng không chứng minh Claude Code thật sự gọi hook như mình nghĩ.
- `test/attack/` chứa các test đối kháng.
- Các trường hợp phải phủ: thành công, bị chặn, hook lỗi, timeout, restart, chạy đồng thời, giả mạo bằng chứng, giả mạo override.
- Phát triển chính verid cũng theo TDD.

## C4. Git và tài liệu

- Dùng Conventional Commits, ví dụ `feat(phase-0): add Claude Code blocking hook`. Không nhắc tới AI trong commit.
- Nhánh cho từng phase, bắt đầu với `feat/phase-0-walking-skeleton`. Không bắt buộc tạo nhánh cho mỗi thay đổi nhỏ.
- Mỗi quyết định kiến trúc quan trọng có một ADR ngắn trong `docs/adr/NNNN-<slug>.md`, gồm: bối cảnh, quyết định, các lựa chọn thay thế, hệ quả.

## C5. Phiên bản schema

- `manifest.yaml`, `state.json` và `tdd-evidence.json` đều có trường `schemaVersion`.
- Gặp phiên bản lạ thì **không đoán cấu trúc** và không bỏ qua trường lạ một cách nguy hiểm. Lúc đó: deny hoặc dừng, báo lỗi rõ ràng, và hướng dẫn chạy `verid upgrade` nếu có migration.
- `verid upgrade` chỉ migrate có kiểm soát và bảo toàn dữ liệu. Nếu không có migration an toàn thì dừng và hướng dẫn developer xử lý thủ công.
- Có test cho: migration, dữ liệu hỏng, phiên bản không được hỗ trợ.

## Định danh không dịch

Các định danh sau giữ nguyên ở mọi ngôn ngữ: tên phase (`discover`…`finish`), tên state (`RED`, `GREEN`, `REFACTOR`, `BLOCKED`…), mode (`prep`, `recipe`, `remix`), loại công việc, key JSON, mã lỗi.
