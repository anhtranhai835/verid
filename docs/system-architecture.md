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

- Node.js ≥22 LTS. TypeScript được bundle bằng esbuild thành hai entry là `dist/hook.js` và `dist/cli.js` (lệnh `verid`), cùng các chunk dùng chung. `yaml` nằm ở một chunk riêng, chỉ được nạp khi cần ([ADR-0008](adr/0008-hook-enforced-tdd-cycle.md)). `tsc --noEmit` chỉ dùng để kiểm tra kiểu.
- Hook chạy bằng `node <đường dẫn cài>/dist/hook.js`. CLI chạy bằng `node <đường dẫn cài>/dist/cli.js <lệnh>`, hoặc `verid <lệnh>` sau khi `npm link`.
- Phụ thuộc runtime: `zod`, `yaml`, `fast-xml-parser` ([ADR-0004](adr/0004-runtime-dependencies.md)). Code dùng `zod/mini` để tree-shake được.
- Số đo Phase 0 trên Windows: bundle đầy đủ zod (777 KB) cho p95 khởi động hook 225 ms. Với `zod/mini` (70 KB): p95 khoảng 140 ms, mốc `node -e 0` là khoảng 90–120 ms. Ngưỡng chấp nhận: p95 < 200 ms.
- Số đo Phase 1 trên Linux (median/p95): Read 80/104 → 83/109 ms; Write khi cache manifest trúng 79/107 → 84/115 ms; Write khi cache trượt 105/141 ms. Chưa đo trên Windows.

## Cấu hình ([ADR-0005](adr/0005-declarative-manifest.md))

`<verid>/manifest.yaml` chỉ chứa khai báo, verid không chạy code nào từ file này. Nội dung gồm: `schemaVersion`, `layout` (monorepo | workspace), `mode` (prep | recipe | remix), `language` (vi | en), `repos{path, test_cmd, default_branch}`.

Phase 1 mới đọc `schemaVersion` và đúng một repo. Key lạ bị từ chối (`VERID_E_MANIFEST_INVALID`):

```yaml
schemaVersion: 1
repos:
  - path: .                 # tương đối với thư mục project, mặc định "."
    test_cmd: npx vitest run --reporter=junit --outputFile={junit}
    source_globs: ["src/**"]
    test_globs: ["test/**", "**/*.test.ts"]
```

`{junit}` được thay bằng đường dẫn (đã quote) tới file JUnit của lần chạy. Glob dùng `/`, tương đối với `path`, và hỗ trợ `**`, `*`, `?`.

Agent không được sửa `manifest.yaml`. Đây là đầu vào của policy, nên chỉ developer được sửa.

## State và dữ liệu ([ADR-0006](adr/0006-json-state-atomic-lock.md))

| Dữ liệu | Vị trí | Git | Người ghi |
|---|---|---|---|
| Runtime state: phase, state, bộ đếm, override, `last_denied`, vòng TDD (`tdd.state`, `tdd.last_run`) | `<verid>/.state/state.json` | ignore | verid |
| Kết quả chạy test (`junit.xml`, `output.log`, `run.json`) | `<verid>/.state/runs/<id>/` | ignore, giữ 30 ngày | verid |
| Manifest đã validate, theo sha256 của file | `<verid>/.state/manifest.cache.json` | ignore | verid |
| Audit log (có hash chain) | `<verid>/.state/audit.jsonl` | ignore, giữ 30 ngày | verid |
| Bằng chứng có cấu trúc | `<verid>/work/<id>-<slug>/tdd-evidence.json` | commit | verid |
| Bằng chứng xuất lúc finish | `<verid>/work/<id>-<slug>/evidence/` | commit | verid |
| Artifacts | `<verid>/work/<id>-<slug>/*.md` | commit | agent viết, developer review |

Cách ghi state:
- Ghi atomic: ghi ra file tạm rồi rename. Trên Windows, gặp EPERM/EBUSY/EACCES (một hook khác đang mở file, antivirus, OneDrive) thì thử lại trong tối đa 2 giây.
- Khoá bằng lockfile tạo theo kiểu độc quyền (`open` với cờ `wx`), chờ tối đa 3 giây; hết giờ thì deny `VERID_E_LOCK_TIMEOUT`. Lock được coi là bị bỏ lại khi đã cũ hơn 10 giây, hoặc khi PID giữ lock đã chết **và** lock cũ hơn 1 giây. Điều kiện 1 giây có từ một race thật đo được ở Phase 0: lock của tiến trình vừa nhả rồi thoát bị xoá nhầm trong khi file đã thuộc về tiến trình khác. Trước khi xoá lock luôn đọc lại nội dung; lúc nhả lock chỉ xoá nếu lock vẫn là của mình.
- Mọi file đều có `schemaVersion`. Phase 0 cho phép developer tự tạo state bằng `{"schemaVersion":1}` (các trường khác có mặc định) cho tới khi có `verid init`.
- `audit.jsonl`: mỗi dòng là `canonicalJson({...bản ghi, prev_hash, hash})`, với `hash = sha256(prev_hash + canonicalJson(bản ghi gồm prev_hash, không gồm hash))`; dòng đầu có `prev_hash` là 64 số 0. Audit ghi khi bị chặn, khi có sự kiện override, ở mỗi lần `verid test` (`test_run`, kèm sha256 của `junit.xml`), khi vòng TDD bị đưa về RED (`tdd_reopened`), và ở `SessionStart`/`Stop`. Các hành động được cho qua khác thì không ghi.

## Đăng ký hook với Claude Code

| Event | Cấu hình | Lý do (spike S3) |
|---|---|---|
| `PreToolUse` (matcher `*`) | **`onFailure: "block"`** | Thiếu cờ này thì hook crash hoặc treo sẽ để tool chạy |
| `UserPromptSubmit` | không đặt `onFailure` | Lỗi thì prompt vẫn được gửi đi, không tạo override |
| `Stop`, `SessionStart` | không đặt `onFailure` | Không bao giờ chặn (`onFailure` cũng không có tác dụng với `Stop`) |

Mọi handler dùng `command: "node"` + `args: ["<đường dẫn>/dist/hook.js"]` (spawn trực tiếp, không qua shell, tránh lỗi quoting trên Windows) và tự đặt `timeout` ngắn, vì mặc định của Claude Code là 600 giây. Xem [manual-hook-checklist.md](manual-hook-checklist.md).

## Luồng của hook

1. Đọc stdin → zod validate (chỉ các trường verid dùng; Claude Code thêm trường giữa các phiên bản) → chuyển thành `Action`. Đường dẫn được chuẩn hoá: tuyệt đối, xử lý `..`, realpath phần đã tồn tại, chữ thường trên Windows. Payload sai → deny `VERID_E_PAYLOAD`.
2. `core.decide()` → `PolicyDecision`.
3. Cho qua: đọc state để chắc chắn state dùng được (thiếu, hỏng hoặc `schemaVersion` lạ → deny). Nếu là ghi file và có manifest thì qua thêm cổng TDD: có thể chặn (sang bước 4), hoặc cho qua và đưa vòng về RED (lấy lock, ghi audit `tdd_reopened`, ghi state). Sau đó exit 0.
4. Chặn: lấy lock → đọc lại state → nếu có override khớp và chưa dùng thì tiêu thụ nó và cho qua; nếu không thì tăng `blocked_actions` và ghi `last_denied`. Ghi audit trước, ghi state sau, rồi nhả lock.
5. Kết quả: exit 2, stderr ghi `verid [CODE]` kèm thông điệp vi và en cùng bước tiếp theo. Phase 0 in cả hai ngôn ngữ; khi có manifest thì `language` sẽ chọn một.
6. Mọi exception không lường trước: `PreToolUse` → deny `VERID_E_INTERNAL`; `UserPromptSubmit` → cho prompt qua kèm `systemMessage` cảnh báo; `Stop`/`SessionStart` → exit 0.

Override: xem [ADR-0007](adr/0007-two-step-override-attended-session.md).

## Vòng TDD ([ADR-0008](adr/0008-hook-enforced-tdd-cycle.md))

Vòng RED-GREEN-REFACTOR của `superpowers:test-driven-development`, được ép bằng hook. Bằng chứng do `verid test` tạo ra:

1. Đọc state và manifest. Thiếu một trong hai thì dừng, không chạy gì.
2. Chạy `test_cmd` qua shell của hệ điều hành (`cmd.exe` trên Windows) với thư mục làm việc là `repos[0].path`. Toàn bộ output được ghi vào `.state/runs/<id>/output.log`.
3. `core.classify(exitCode, junit)`: chỉ khi mã thoát và báo cáo JUnit khớp nhau thì lần chạy mới là bằng chứng (`pass` hoặc `fail`). Các trường hợp còn lại là `VERID_E_RUN_NO_JUNIT`, `VERID_E_RUN_NO_TESTS` hoặc `VERID_E_RUN_EXIT_MISMATCH`: state giữ nguyên, CLI thoát với mã 2.
4. Lấy lock, `core.transition()`, rồi ghi `run.json`, ghi audit `test_run`, ghi state.
5. In tên các test fail kèm thông điệp lỗi, cùng bước tiếp theo. Mã thoát: 0 = pass, 1 = fail, 2 = không phải bằng chứng.

| Trạng thái | Ghi code production | Ghi test | `verid test` fail | `verid test` pass |
|---|---|---|---|---|
| RED | chặn | được | → GREEN | giữ RED |
| GREEN | được | được, về RED | giữ GREEN | → REFACTOR |
| REFACTOR | được | được, về RED | → GREEN | giữ REFACTOR |

`verid status` cho biết trạng thái hiện tại và bước tiếp theo. Agent không đọc được `.state/`, nên đây là cách để agent biết mình đang ở đâu.

## Rule của hook

| Rule | Override được | Phủ |
|---|---|---|
| `VERID_E_STATE_PROTECTED` | không | Đọc/ghi `.verid/.state/**`; Bash có chuỗi `.state` |
| `VERID_E_SECRET_PROTECTED` | không | Mọi tool file và Bash chạm tới file bí mật: `.env`, `.env.*` (trừ `.env.example`, `.env.sample`, `.env.template`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `.ssh/**`, `.npmrc`, `.pypirc`, `.netrc`, `*credentials*`, `*secret*` |
| `VERID_E_TRANSCRIPT_PROTECTED` | không | Tool file và Bash chạm tới `~/.claude/projects/**` |
| `VERID_E_MANIFEST_PROTECTED` | có | Ghi `.verid/manifest.yaml`; Bash có chuỗi `manifest.yaml` |
| `VERID_E_BASH_NESTED_CLAUDE` | có | Bash gọi chương trình `claude` |
| `VERID_E_TDD_NO_FAILING_TEST` | có | Phase 1, chỉ khi có manifest: tool ghi file vào đường dẫn khớp `source_globs` (và không khớp `test_globs`) khi vòng TDD đang ở RED |

## Giới hạn đã biết

- Hook của Claude Code không phải sandbox của hệ điều hành. verid không ngăn được mọi cách truy cập hệ thống.
- Hash chain giúp phát hiện log bị sửa, nhưng không ngăn được việc sửa.
- Hash của file chỉ phát hiện thay đổi, không chứng minh test viết tốt.
- Rule Bash ở Phase 0 so chuỗi và tách token, nên dễ lách (`cat .e""nv`, biến môi trường, script trung gian, `node -e`). Đôi khi chặn nhầm, ví dụ commit message có chữ `secret`/`credentials`, hoặc `jq '.key'`. Phase 4 thay bằng allowlist.
- Grep/Glob quét cả thư mục có thể chạm vào nội dung file bí mật nằm bên trong. Chỉ chặn khi đích là chính file hoặc thư mục bí mật.
- Tool MCP có quyền ghi hoặc đọc file (`mcp__*`) chưa bị kiểm tra (Phase 4).
- Junction/symlink chỉ được resolve cho phần đường dẫn đã tồn tại; tên ngắn 8.3 (`VERID~1`) của file chưa tồn tại có thể lách so khớp.
- `rm -r .verid` không bị chặn ở Phase 0, nhưng xoá state làm mọi tool call bị chặn (`VERID_E_STATE_MISSING`), không reset được bộ đếm.
- Mã xác nhận override vẫn nằm trong file transcript trên đĩa. Agent bị chặn đọc thư mục đó, nhưng lớp chặn chính là `CLAUDE_CODE_SESSION_ATTENDED`.
- `CLAUDE_CODE_SESSION_ATTENDED` là biến nội bộ của Claude Code; nếu bị đổi tên thì override ngừng hoạt động (vẫn an toàn).
- Khi rất nhiều hook chạy song song trên máy chậm, một hook bị chặn có thể nhận `VERID_E_LOCK_TIMEOUT`: vẫn bị chặn, nhưng không được cộng vào bộ đếm. Với bundle cũ (p95 khoảng 225 ms), 40 tiến trình cùng lúc từng gặp trường hợp này. Với bundle hiện tại, đo được 0 lỗi qua 30 vòng × 40 tiến trình và 50 vòng × 20 tiến trình.
- Fixture payload hiện chỉ có của Windows, nên `test/e2e/hook.e2e.test.ts` chỉ pass trên Windows. `test/e2e/tdd.e2e.test.ts` tự dựng đường dẫn, nên chạy được ở mọi hệ điều hành.
- Cổng TDD chỉ xét các tool ghi file (Write, Edit, MultiEdit, NotebookEdit). Ghi file bằng Bash (`echo >`, `sed -i`) thì lách được cổng, kể cả sửa test mà không đưa vòng về RED (Phase 4).
- verid không biết code viết trong GREEN/REFACTOR có vượt quá những gì test đòi hỏi hay không. Phần này vẫn cần developer duyệt.
- Code test do agent viết chạy với toàn quyền trong lúc `verid test` chạy, nên có thể ghi đè `junit.xml`. sha256 trong audit chỉ giúp phát hiện việc sửa file về sau.
- `test_cmd` không có timeout riêng: lệnh treo thì `verid test` treo theo, cho tới khi Bash tool của Claude Code hết giờ.
- So khớp glob không phân biệt hoa thường trên mọi hệ điều hành.
- State do Phase 1 ghi có trường `tdd`; quay về bản Phase 0 thì state đó bị coi là hỏng (`VERID_E_STATE_CORRUPT`).
