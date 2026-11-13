# Plugin quy trình

Developer chạy trong terminal riêng tại gốc project:

```sh
verid plugin add file:../verid/examples/plugins/sample
verid plugin add git:https://example.org/team/plugin.git#v1.0.0
verid plugin list
verid plugin doctor
verid plugin remove sample
```

Với tài nguyên repo, thay `verid` bằng `node .verid/verid.mjs`. Trước khi cài, CLI in mọi
lệnh setup và hook rồi yêu cầu trả lời `yes`. `--yes` bỏ câu hỏi. Bản đầu không có nguồn
npm, registry, tự cập nhật hay lệnh chạy plugin tùy ý.

Plugin là code chạy với quyền của bạn; hãy đọc nguồn trước khi cài. Các lệnh chạy trực
tiếp bằng đối số, không qua shell: dấu nháy gom đối số, còn toán tử shell, biến và pipeline
không được diễn giải. Trên Windows dùng `node` hoặc `.exe`, không dùng shim `.cmd`/`.ps1`.
Mỗi lệnh có hạn 300 giây; kiểm prerequisite bằng `--version` có hạn 10 giây.

## Hợp đồng gói

Gốc gói có `verid-plugin.json` như [mẫu](../examples/plugins/sample/verid-plugin.json).
Bốn trường bắt buộc: `name`, `version`, `veridApi: "1"`, `description`. Tên kebab-case,
không dùng tên thiết bị Windows hoặc namespace `verid`. Version theo `major.minor.patch`,
có thể thêm prerelease/build. Các trường tùy chọn:

- `requires`: mảng `{ bin, version?, install? }`; version chính xác hoặc một phép so
  sánh `=`, `>`, `>=`, `<`, `<=`, `^`, `~` với `major.minor.patch`. `install` chỉ là hướng dẫn.
- `setup`: mảng lệnh idempotent, chạy một lần mỗi lần cài trong **gốc project**.
- `hooks`: ánh xạ sự kiện sang lệnh, chạy trong **thư mục plugin**.
- `skills`: thư mục chứa `SKILL.md`; `agents`: file Markdown có frontmatter.
- `config`: object JSON mặc định.

Setup và hook nhận `VERID_PROJECT`, `VERID_PLUGIN_DIR`, `VERID_PLUGIN_DATA`,
`VERID_PLUGIN_CONFIG` (JSON). Setup có thể dùng Node đọc `process.env.VERID_PLUGIN_DIR`
để tìm script; không có nội suy biến shell. Setup không được sửa gói đã duyệt. Lỗi ở
bất kỳ bước nào thì không đăng ký; tác động ngoài thư mục cài của setup không thể hoàn tác.

Đường dẫn tài nguyên tương đối trong gói, không chứa liên kết. CLI chép tài nguyên vào
`.verid/skills/`, `.verid/agents/` với tiền tố `<plugin>-`; Claude nhận bản skill/agent
native, Codex nhận skill trong `.agents/skills/`. Agent Markdown còn ở
project để host sử dụng theo khả năng của nó. Không ghi đè tài nguyên khác. Plugin được
bật tự thêm tên tài nguyên vào danh sách dispatch; không sửa manifest hoặc gán vai trò
ghi. Developer phải tự sửa `roles` trong manifest nếu cần; gate TDD và vai trò vẫn áp dụng.

## Sự kiện

Payload JSON qua stdin, tên sự kiện còn ở `VERID_PLUGIN_EVENT`:

| Sự kiện       | Sau khi                             | Các trường                                      |
| ------------- | ----------------------------------- | ----------------------------------------------- |
| `after-order` | CLI ghi approval của một module     | `event`, `module`, `acs`, `dossier`             |
| `on-state`    | taste hợp lệ làm đổi trạng thái TDD | `event`, `module` hoặc null, `from`, `to`       |
| `after-serve` | CLI ghi đóng module                 | `event`, `module`, `commit` hoặc null, `review` |

Bao gồm thao tác board gọi cùng handler CLI. Ký cả plan no-brain không order một module
cụ thể; quyết định module tự động trong hook provider không chạy plugin. Taste không đổi
trạng thái hoặc không hợp lệ thì không phát sự kiện. Stdout của plugin phải rỗng hoặc là
một object JSON; nội dung đó không thay quyết định gate. Hook lỗi, timeout, sai JSON hoặc
gói thay đổi: cảnh báo một dòng và ghi audit; approval, TDD và kết quả serve vẫn giữ nguyên.
Plugin mẫu ghi từng payload vào `.verid/.plugin-data/sample/events.jsonl`.

## Chia sẻ và bảo trì

Commit `.verid/plugins.json` (nguồn, version, bật/tắt, config, tài nguyên sở hữu, digest
gói và Git SHA), bản tài nguyên đã sinh và `.verid/.plugin-data/`. Không commit
`.verid/.plugins/`; cài plugin đầu tiên thêm ignore, cook duy trì khi registry tồn tại.

Đồng đội clone rồi chạy `verid cook --yes`: cài lại code thiếu, giữ config, kiểm digest
đúng bản đã duyệt. Nguồn Git checkout SHA đã ghi dù ref di chuyển; nếu không có `--yes`
thì hỏi xác nhận trước khi chạy lệnh plugin. Nguồn file tính từ gốc project, nên dùng
đường dẫn tương đối dùng chung. Nguồn không còn hoặc đã đổi phải do developer xử lý;
không tự chạy bản mới. `cook --dry-run` không tải/chạy plugin.

Developer sửa `enabled` hoặc `config` trong registry; plugin tắt không nhận sự kiện và
không thêm tên dispatch. `plugin doctor` kiểm code, prerequisite, bản tài nguyên, lệch
version và digest; `verid doctor` gộp các phát hiện này. `doctor --ci` chỉ kiểm registry
đã commit, bỏ kiểm cài đặt theo máy. Remove xóa code và các file tài nguyên đã ghi nhận,
giữ dữ liệu chung. Muốn nâng bản thì remove rồi add rõ ràng.

Hook chặn agent sửa registry, code, dữ liệu, định nghĩa đã sinh và gọi mọi lệnh plugin.
`VERID_BURNT_PLUGIN_PROTECTED` không được nâng bằng `/verid tip`. Hook không cô lập code
plugin mà developer đã tin cậy; code đó có cùng quyền hệ điều hành với developer.
