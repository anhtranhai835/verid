# verid: kiến trúc hệ thống

Trạng thái: đã chốt ngày 2026-10-19. Các quyết định gốc nằm trong [ADR](adr/).
Kế hoạch triển khai nằm trong `plans/` (chỉ lưu trên máy, không commit).

## Tổng quan

verid là harness TDD cho Claude Code, hoạt động ở hai lớp:
- **Lớp prompt:** skills, agents và templates song ngữ vi/en. Các skill này gọi `superpowers:*` từ plugin superpowers cài bên ngoài.
- **Lớp ép buộc:** một hook entry duy nhất, cùng với policy engine fail-closed.

Agent làm việc. verid kiểm chứng. Developer duyệt.

## Kiểu kiến trúc: Functional Core, Imperative Shell ([ADR-0002](adr/0002-functional-core-imperative-shell.md))

```
            ┌──────────────── shell: cli/ + hook.ts ────────────────┐
 stdin ───► │ adapters/claude-code  → Action                        │
            │ adapters/state-store  → State (đọc, có lock)          │
            │            │                                          │
            │            ▼                                          │
            │   core/  decide(action, state) → PolicyDecision       │  ← thuần, không I/O
            │          transition(state, event) → State | Error     │
            │          classify(junit) → RunVerdict                 │
            │            │                                          │
            │            ▼                                          │
            │ adapters/state-store  ← ghi state (atomic + lock)     │
            │ adapters/audit-log    ← ghi audit (hash chain)        │
            │ adapters/claude-code  ← exit 0 | exit 2 + stderr      │
            └───────────────────────────────────────────────────────┘
```

Chiều phụ thuộc: `core ← adapters ← cli/hook`. `core/` không được import `node:fs`, `node:child_process`, `node:net` hay `process`. Có một test kiểm tra luật này.

## Cấu trúc repo ([ADR-0001](adr/0001-single-package.md))

```
verid/
├── src/
│   ├── core/        # state machine, policy rules, phân loại evidence, bộ đếm, override, mã lỗi
│   ├── adapters/    # claude-code, state-store, audit-log, test-runner, junit, git, manifest
│   ├── cli/         # init, upgrade, doctor, test, next, done, status
│   └── hook.ts      # entry cho PreToolUse(*), UserPromptSubmit, Stop, SessionStart
├── content/{en,vi}/{skills,agents,templates}
├── i18n/{en,vi}.json
├── test/{unit,e2e,attack,fixtures}
└── docs/{adr/, system-architecture.md, code-standards.md}
```

## Runtime ([ADR-0003](adr/0003-node-22-runtime.md))

- Node.js ≥22 LTS. TypeScript được build ra `dist/`.
- Hook chạy bằng `node <đường dẫn cài>/dist/hook.js`.
- Phụ thuộc runtime: `zod`, `yaml`, `fast-xml-parser` ([ADR-0004](adr/0004-runtime-dependencies.md)).

## Cấu hình ([ADR-0005](adr/0005-declarative-manifest.md))

`<verid>/manifest.yaml` chỉ chứa khai báo, verid không chạy code nào từ file này. Nội dung gồm: `schemaVersion`, `layout` (monorepo | workspace), `mode` (prep | recipe | remix), `language` (vi | en), `repos{path, test_cmd, default_branch}`.

Agent không được sửa `manifest.yaml`. Đây là đầu vào của policy, nên chỉ developer được sửa.

## State và dữ liệu ([ADR-0006](adr/0006-json-state-atomic-lock.md))

| Dữ liệu | Vị trí | Git | Người ghi |
|---|---|---|---|
| Runtime state: phase, state, bộ đếm, override, `last_denied` | `<verid>/.state/state.json` | ignore | verid |
| Kết quả chạy test thô (JUnit, log) | `<verid>/.state/runs/` | ignore, giữ 30 ngày | verid |
| Audit log (có hash chain) | `<verid>/.state/audit.jsonl` | ignore, giữ 30 ngày | verid |
| Bằng chứng có cấu trúc | `<verid>/work/<id>-<slug>/tdd-evidence.json` | commit | verid |
| Bằng chứng xuất lúc finish | `<verid>/work/<id>-<slug>/evidence/` | commit | verid |
| Artifacts | `<verid>/work/<id>-<slug>/*.md` | commit | agent viết, developer review |

Cách ghi state:
- Ghi atomic: ghi ra file tạm rồi rename.
- Khoá bằng lockfile tạo theo kiểu độc quyền (`open` với cờ `wx`), có timeout và xử lý lock bị bỏ lại (stale lock).
- Mọi file đều có `schemaVersion`.

## Luồng của hook

1. Đọc stdin → zod validate → chuyển thành `Action`. Payload sai → deny `VERID_E_PAYLOAD`.
2. Lấy lock → đọc state. State hỏng hoặc `schemaVersion` lạ → deny.
3. `core.decide()` → `PolicyDecision`.
4. Ghi audit, cập nhật state, nhả lock.
5. Kết quả: `allow` → exit 0. `deny` → exit 2, stderr ghi `verid [CODE]: <thông điệp đã dịch>`.
6. Mọi exception không lường trước → deny `VERID_E_INTERNAL`. Hook được đăng ký với `onFailure: "block"`.

## Giới hạn đã biết

- Hook của Claude Code không phải sandbox của hệ điều hành. verid không ngăn được mọi cách truy cập hệ thống.
- Hash chain giúp phát hiện log bị sửa, nhưng không ngăn được việc sửa.
- Hash của file chỉ phát hiện thay đổi, không chứng minh test viết tốt.
