# Provider và bảo vệ

## Agents, skills và tích hợp provider

`AGENTS.md` là nguồn chỉ dẫn chung. `CLAUDE.md` import qua `@AGENTS.md`.
Hook kiểm tra lệnh gọi tool độc lập với phần chỉ dẫn bằng văn bản.

| Công việc         | Skill                       | Người ghi/review                     |
| ----------------- | --------------------------- | ------------------------------------ |
| Làm quen project  | `onboard`                   | Main; đọc và báo cáo.                |
| Research và spec  | `ba`                        | Main.                                |
| Hồ sơ module      | `modules`                   | Main, dùng template repo.            |
| Kiến trúc         | `design`                    | Architect đã ánh xạ hoặc Codex main. |
| Kế hoạch module   | `plan`                      | Planner đã ánh xạ hoặc Codex main.   |
| TDD và triển khai | `build`, `tdd`, `debugging` | Tester/QA và coder hoặc Codex main.  |
| Đánh giá          | `review`, `security`        | Reviewer độc lập chỉ đọc.            |

Với tài nguyên Claude đã cài, tên dùng dạng `verid:<name>`. Ví dụ:

```sh
claude plugin marketplace add anhtranhai835/verid
claude plugin install verid@verid
```

Tài nguyên repo dùng entry `verid-<name>` trong `.claude/skills/` và
`.claude/agents/`, dẫn về `.verid/skills/` và `.verid/agents/`.
Codex nhận diện entry skill local từ `.agents/skills/`.

Skill onboard kiểm kê repo và runner, báo tình trạng và bước tiếp theo.
Nó đề xuất các thay đổi manifest để developer áp dụng.

## Bảo vệ và audit

Hook bảo vệ runtime state, bí mật, định nghĩa provider, bundle hook và block chỉ dẫn.
Nó kiểm tra approval module, vòng TDD và vai trò ghi. Các lệnh Codex được hỗ trợ
gồm `apply_patch`, shell và gọi reviewer.

Coverage spec, thứ tự phụ thuộc, quy ước kiến trúc và danh sách dispatch đã biết
còn tạo cảnh báo tham khảo. Quy ước `.verid/rules/architecture.md` và kết quả
`architecture_check` là chỉ dẫn không chặn; doctor và menu hiển thị các cảnh báo này.
Xem [bảng rule hook đầy đủ](hook-reference.vi.md)
để biết mã rule và cách override. Ngoại lệ một lần gọi cần developer trực tiếp
trong Claude Code.

## Những gì nằm trong .verid

Cây dưới đây dùng `modular` với tài nguyên `repo`. File tích hợp provider được tạo
theo provider đã chọn; hồ sơ module xuất hiện sau `verid module`.

```text
.verid/
├── manifest.yaml
├── verid.mjs                   # launcher CLI local; chạy bằng node
├── workflow.md
├── constitution.md
├── architecture-profile.md
├── ownership.yaml
├── docs/                      # tài liệu nguồn; agent chỉ đọc
├── research.md                # ghi sau research
├── spec.md                    # yêu cầu đã thống nhất, ID duy nhất
├── design.md                  # kiến trúc và interface đã thống nhất
├── plan.md                    # AC kiểm thử được của từng module
├── agents/                    # gồm reviewer TOML cho Codex
├── skills/                    # có scripts, references và licenses
├── templates/
├── hooks/                     # CLI, hook và thư viện runtime được bundle
├── i18n/
├── policies/
├── rules/
├── approvals/                 # ghi nhận quyết định bằng văn bản
├── artifacts/
│   ├── 00-baseline/
│   ├── 01-research/
│   ├── 02-discovery/
│   ├── 03-modules/<module>/
│   │   ├── ba/
│   │   ├── ui/
│   │   ├── spec/
│   │   ├── tests/
│   │   ├── security/
│   │   ├── review/
│   │   └── release/
│   ├── 04-plans/
│   ├── 05-implementation/
│   ├── 06-evaluation/
│   ├── 07-release/
│   └── adr/
├── log/<module>.md            # main thêm một entry cho mỗi AC
├── review/work.md             # snapshot review do CLI tạo
└── .state/                    # approval, test evidence và audit runtime; được ignore
```

Commit templates, tài nguyên repo, tài liệu nguồn, hồ sơ module và các tài liệu
project đã thống nhất. Với monorepo, commit thêm `AGENTS.md`, `CLAUDE.md` khi có và
các entry agents/skills của provider. Cấu hình reviewer Codex theo repo nằm ở
`.codex/config.toml`.

Giữ `.verid/.state/` ngoài Git. `.codex/hooks.json` và
`.claude/settings.local.json` là wiring theo từng máy. `approvals/` chứa bản ghi
quyết định; approval thực của verid vẫn nằm trong trạng thái runtime riêng.

## Làm việc cùng thành viên mới

Sau khi clone project dùng tài nguyên repo, chạy `node .verid/verid.mjs cook --yes`
tại gốc project hoặc workspace. CLI đã được commit sẵn, chạy bằng Node.js.
Với tài nguyên installed, cài CLI và chạy `verid cook`.
Lựa chọn trong manifest và tài nguyên repo đã có được giữ lại; cook thêm file setup
còn thiếu và nối lại hook cho máy hiện tại.

Với workspace nhiều repo, chia sẻ repository `.verid`. Cook có thể clone repo
còn thiếu từ remote đã cấu hình trong manifest. Với monorepo, commit entry provider
và chỉ dẫn cùng source repo; với workspace, tạo lại các entry ở gốc theo từng máy.
