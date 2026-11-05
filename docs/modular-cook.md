# Modular cook theo mẫu 10-repo-structure

Luồng này dùng cây workspace và hồ sơ module từ `10-repo-structure.md` của người dùng,
đổi tên workspace thành `.verid/` để tích hợp các gate TDD đang có của verid.
Không yêu cầu chuyển source code dự án sang monorepo Haren/Bun.

## Chọn trong cook

| Lựa chọn  | Giá trị                | Tác dụng                                                                              |
| --------- | ---------------------- | ------------------------------------------------------------------------------------- |
| Workflow  | `classic` (mặc định)   | Research, spec, design, plan chung như hiện tại                                       |
| Workflow  | `modular`              | Thêm hồ sơ từng module và cây artifact theo phase của mẫu                             |
| Resources | `installed` (mặc định) | Dùng plugin/skills từ bản cài trên máy                                                |
| Resources | `repo`                 | Đưa agents, skills, templates, hooks, bản dịch và policies vào repo; dùng các bản này |

Hai lựa chọn độc lập. `modular` dùng với `prep` hoặc `recipe`; `remix` vẫn dùng baseline.
Cook lưu lựa chọn trong manifest. Khi chạy lại, manifest đang có quyết định cấu hình;
CLI báo các flag cấu hình bị bỏ qua. Để chuyển project đã cook, developer chỉnh
`workflow: modular` và/hoặc `resources: repo` trong manifest rồi chạy lại cook.
Nếu chuyển sang repo resources, đổi các role Claude `verid:<name>` thành `verid-<name>`;
Codex giữ reviewer `verid_reviewer`. Cook giữ những role đã được người dùng ánh xạ.

```sh
verid cook --mode prep --workflow modular --resources repo --provider codex --yes
verid module identity
verid menu
```

Thêm `--provider claude-code` để dùng cả hai provider. Bỏ hai flag mới để dùng mặc định.
Từ checkout source, build rồi thay `verid` bằng `node /path/to/verid/dist/cli.js`.

## Cây được tạo

```text
your-project/
├── AGENTS.md                           # chỉ dẫn chung, đường dẫn tài nguyên repo
├── CLAUDE.md                           # khi chọn Claude Code
├── .claude/
│   ├── settings.local.json             # hook riêng cho máy
│   ├── agents/verid-*.md               # entry đọc .verid/agents/
│   └── skills/verid-*/SKILL.md          # entry đọc .verid/skills/
├── .agents/skills/verid-*/SKILL.md      # discovery skills cho Codex
├── .codex/
│   ├── config.toml                     # reviewer của project, đường dẫn tương đối
│   └── hooks.json                      # hook riêng cho máy, cần trust
└── .verid/
    ├── manifest.yaml
    ├── architecture-profile.md
    ├── constitution.md
    ├── ownership.yaml
    ├── workflow.md
    ├── docs/                           # tài liệu nguồn, agent chỉ đọc
    ├── research.md                     # agent viết sau research
    ├── spec.md                         # agent viết yêu cầu đã thống nhất
    ├── design.md                       # agent viết thiết kế đã thống nhất
    ├── plan.md                         # agent viết AC toàn dự án
    ├── agents/                        # có cả reviewer TOML của Codex
    ├── skills/                        # đầy đủ scripts, references, licenses
    ├── templates/                     # bộ mẫu dùng khi verid module
    ├── hooks/                         # bundle hook và các chunk đi kèm
    ├── i18n/
    ├── policies/                      # quy ước dự án; enforcement do hook/manifest
    ├── rules/
    ├── approvals/                     # ghi quyết định; không phải HMAC runtime
    ├── artifacts/
    │   ├── 00-baseline/
    │   ├── 01-research/
    │   ├── 02-discovery/
    │   ├── 03-modules/<module>/
    │   │   ├── ba/requirements.md
    │   │   ├── ui/brief.md
    │   │   ├── spec/spec.md
    │   │   ├── spec/design.md
    │   │   ├── tests/test-plan.md
    │   │   ├── security/threat-model.md
    │   │   ├── review/review.md
    │   │   └── release/release-plan.md
    │   ├── 04-plans/
    │   ├── 05-implementation/
    │   ├── 06-evaluation/
    │   ├── 07-release/
    │   └── adr/
    └── .state/                         # bằng chứng/approval/audit runtime; gitignore
```

Các thư mục tài nguyên và entry provider phụ thuộc lựa chọn `resources`/`provider`.
Cook tạo template, không tạo sẵn bốn tài liệu research/spec/design/plan với nội dung giả;
gate tiếp tục chờ tài liệu thật. `verid module` chỉ tạo bản nháp và giữ file đã có.

## Điền module và chạy một vòng

1. Đặt tài liệu nguồn vào `.verid/docs/`. Cho agent đọc `.verid/workflow.md`, skill
   `modules` và template repo, sau đó research → discovery → xác định module.
2. Chạy `verid module identity`. Điền scope, EARS requirements, nguồn, UI states
   (hoặc lý do không áp dụng), contracts, input/output/errors, data/invariants,
   dependency boundaries, test mapping, STRIDE và abuse cases. Resolve mọi
   `[NEEDS CLARIFICATION: ...]` trong sáu tài liệu đầu vào trước order.
3. Tổng hợp yêu cầu đã chốt vào `.verid/spec.md`, kiến trúc vào `.verid/design.md`,
   AC vào `.verid/plan.md`. ID REQ/NFR/SEC/AC phải duy nhất toàn dự án.

   ```markdown
   ## Module: identity

   Artifacts: .verid/artifacts/03-modules/identity
   Review Focus: SEC-1, authorization failures and input validation.

   - AC-1: valid credentials open the member workspace (REQ-1)
   - AC-2: invalid credentials return the agreed generic error (REQ-2, SEC-1)
   ```

4. Human drive: developer chạy `verid order identity`. Auto drive: developer chạy
   `verid order` để ký research/spec/design rồi agent tiếp tục vòng auto hiện có.
   Cả hai dùng hồ sơ module khi xét plan. Signature của module gồm section plan
   và sáu file BA/UI/spec/design/test-plan/security; thay đầu vào làm approval cũ
   hết hiệu lực. Review/release là đầu ra, không thay signature này.
5. Agent viết test đỏ → `verid taste` → implement → `verid taste` xanh → refactor.
   Codex main viết cả test và code; reviewer vẫn chỉ đọc. Ghi execution notes ngoài
   sáu file đầu vào, ở `05-implementation/`; sửa test-plan sau order cần duyệt lại.
6. Tạo review packet bằng `verid menu --commits --file`. Gửi packet, module/spec,
   design và diff cho reviewer mới. Main ghi report thật vào `review/` và evaluation.
7. Serve theo gate hiện có, ghi release plan/evidence và tiếp tục module kế tiếp.
   File report tự viết không thay thế kết quả reviewer hay bằng chứng test runtime.

## Dùng với Codex

Trong chế độ repo, cook tạo `.codex/config.toml` với role `verid_reviewer` trỏ đến
`../.verid/agents/verid-reviewer.toml`. Reviewer đọc skills trong repo và dùng sandbox
read-only. Cook không sửa config Codex của user trong chế độ này. Các entry dưới
`.agents/skills/` đọc bản canonical `.verid/skills/`; các file trong bản canonical vẫn
có tên `verid:<name>`, được hướng dẫn ánh xạ sang local `verid-<name>`.

Sau cook, mở Codex trong project, trust project và các hook verid qua `/hooks`, rồi chạy
`verid doctor`. Trust là quyết định của người dùng trong Codex; cook không giả lập
`trusted_hash`. Sau clone hoặc đổi máy, cài CLI và chạy cook để cập nhật đường dẫn hook.
Cook giữ nguyên bản tài nguyên repo đã có; muốn cập nhật bản pin, developer xem diff và
thay bộ tương ứng. Một project dùng nhiều provider vẫn cần native entry tương ứng.

Commit tài nguyên `.verid/`, template, hồ sơ, `AGENTS.md`, `.agents/skills/`,
`.codex/config.toml` và `.claude/agents|skills/` khi có. Giữ `.state/` ngoài Git;
`.codex/hooks.json` và `.claude/settings.local.json` là wiring theo máy.

Thiết kế này dựa trên [OpenAI Docs về project config](https://learn.chatgpt.com/docs/config-file/config-advanced),
[vị trí skills Codex](https://developers.openai.com/api/reference/cli),
[skills Claude Code](https://code.claude.com/docs/en/skills) và
[agents Claude Code](https://code.claude.com/docs/en/sub-agents).

Test tích hợp `test/e2e/modular-codex.e2e.test.ts` chạy bundle hook từ repo trên payload
Codex để kiểm tra session, TDD, bảo vệ tài nguyên, order, review và hết hiệu lực approval.
Nó dùng test runner fixture; chưa thay thế việc chạy một session model đã được trust
trên project thật của người dùng.

Kiểm tra offline trên Codex CLI 0.166.0 bằng `codex debug prompt-input` cũng xác nhận
project config đọc được và model-visible input có `AGENTS.md`, đường dẫn skills trong
repo cùng skill `verid-modules`. Kiểm tra này không gọi model hoặc tạo trust cho hook
trên project thật.
