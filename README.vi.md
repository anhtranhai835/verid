```
 ██╗   ██╗ ███████╗ ██████╗  ██╗ ██████╗
 ██║   ██║ ██╔════╝ ██╔══██╗ ██║ ██╔══██╗
 ██║   ██║ █████╗   ██████╔╝ ██║ ██║  ██║
 ╚██╗ ██╔╝ ██╔══╝   ██╔══██╗ ██║ ██║  ██║
  ╚████╔╝  ███████╗ ██║  ██║ ██║ ██████╔╝
   ╚═══╝   ╚══════╝ ╚═╝  ╚═╝ ╚═╝ ╚═════╝
     hook-enforced TDD for Claude Code and Codex · RAW → COOKING → PLATED
```

# verid

[English](README.md) · **Tiếng Việt**

> Harness cho spec và TDD trên Claude Code và Codex, dùng hook kiểm tra từng lần ghi.

verid đưa ý tưởng, tài liệu đặc tả hoặc code có sẵn qua một chu trình có thể kiểm tra:

```text
research → spec → design → plan → order → build & test → review → serve
                                           RAW → COOKING → PLATED
```

Yêu cầu, quyết định và hồ sơ module nằm trong `.verid/`. CLI ghi bằng chứng test
và kiểm tra approval; agent làm theo skills đã cài hoặc bản tài nguyên được commit
cùng project.

---

## Vì sao dùng verid?

Trước khi triển khai, project cần thống nhất hành vi, interface và tiêu chí nghiệm
thu. verid ghi những điều đó thành tài liệu rồi nối chúng với test.

- **Lập kế hoạch theo module.** Mỗi module có AC kiểm thử được; developer quyết định khi bắt đầu.
- **Dùng bằng chứng đã ghi nhận.** `verid taste` đối chiếu exit code của runner với báo cáo JUnit.
- **Phân vai rõ ràng.** Claude Code có thể tách tester, coder và reviewer. Codex dùng
  luồng chính viết test/code và reviewer độc lập chỉ đọc.
- **Mang workflow theo repo.** Luồng modular có hồ sơ riêng từng module; tài nguyên
  repo gồm agents, skills, templates và bản hook runtime được pin.
- **Tiếp tục dựa trên trạng thái thực.** `verid menu` cho biết tiến độ module,
  cảnh báo audit và bước tiếp theo.

---

## Yêu cầu

- Node.js **22 trở lên**, có npm trong `PATH`.
- Git để thao tác repository và workspace.
- Claude Code, Codex CLI hoặc cả hai.

## Cài đặt

### Gói đã phát hành

```sh
npm install -g @anhtranhai835/verid
```

Các lệnh cài một dòng cài gói npm đã phát hành và thử thiết lập provider.
Máy cần có Node.js trước.

**Windows — PowerShell**

```powershell
irm https://raw.githubusercontent.com/anhtranhai835/aeriq/main/install.ps1 | iex
```

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/anhtranhai835/aeriq/main/install.sh | sh
```

Trong terminal tương tác, installer có thể hỏi thư mục project rồi chạy
`verid cook`. Với CI hoặc khi không có terminal, tự chạy cook sau khi cài.

### Source hiện tại, gồm luồng modular mới

Dùng bản build từ source nếu gói npm chưa có tính năng mô tả trong README này:

```sh
git clone https://github.com/anhtranhai835/aeriq.git
cd aeriq
npm ci
npm run build
npm install -g .
```

Tên lệnh là `verid`; tên gói npm là `@anhtranhai835/verid`.

---

## Bắt đầu nhanh

Trong project cần làm việc:

```sh
cd your-project
verid cook
```

Cook hỏi ngôn ngữ, provider, workflow, nơi lưu tài nguyên, mode, drive và kiến trúc.
Lệnh tự nhận diện layout và test runner, rồi hiện danh sách file sẽ ghi.
Xác nhận bản xem trước để áp dụng.

Đặt tài liệu có sẵn vào `.verid/docs/`. Mở provider ở gốc project hoặc workspace
và giao việc:

> Đọc AGENTS.md và tài liệu nguồn, rồi hướng dẫn tôi thực hiện bước tiếp theo.

```sh
verid doctor
verid menu
```

Nếu dùng mode `remix` cho code có sẵn, chạy `verid stock` trước khi agent sửa code.

### Bắt đầu với hồ sơ modular và tài nguyên trong repo

```sh
verid cook --mode prep --workflow modular --resources repo --provider codex --yes
verid module identity
```

Điền bản nháp của module, rồi tổng hợp yêu cầu, thiết kế và AC đã thống nhất vào
`.verid/spec.md`, `.verid/design.md` và `.verid/plan.md`. Cook chờ nội dung thật
của các tài liệu đầu vào này để xét approval.

Với Codex, trust project và hook đã tạo qua `/hooks` rồi chạy `verid doctor`.
Xem [thiết lập Codex](#thiết-lập-codex).

---

## Workflow và nơi lưu tài nguyên

Hai lựa chọn này độc lập:

| Cấu hình    | Giá trị                | Kết quả                                                                         |
| ----------- | ---------------------- | ------------------------------------------------------------------------------- |
| `workflow`  | `classic` — mặc định   | Research, spec, design và plan chung cho project.                               |
| `workflow`  | `modular`              | Hồ sơ từng module và thư mục phase theo template cấu trúc repo.                 |
| `resources` | `installed` — mặc định | Skills và agents từ bản đã cài hoặc plugin Claude.                              |
| `resources` | `repo`                 | Chép agents, skills, templates, policies, bản dịch và hook runtime vào project. |

`modular` dùng với `prep` và `recipe`. `remix` dùng workflow baseline hiện có.

Các entry tích hợp provider đọc bản tài nguyên trong repo. Cook thêm file thiếu và
giữ những tùy chỉnh đã có. Khi nâng gói npm, bản tài nguyên repo được pin vẫn được
giữ lại; developer xem diff rồi chủ động thay những bản cần cập nhật.

### Hồ sơ module

`verid module <tên>` lấy mẫu từ `.verid/templates/module/` của project. Lệnh tạo
bản nháp và giữ file đã tồn tại.

| Thư mục     | Nội dung cần ghi                                                              |
| ----------- | ----------------------------------------------------------------------------- |
| `ba/`       | Vấn đề, người dùng, phạm vi, yêu cầu EARS, nguồn và ví dụ.                    |
| `ui/`       | Journey, màn hình, trạng thái, tokens, accessibility hoặc lý do không có UI.  |
| `spec/`     | Contracts, dữ liệu, invariants, lỗi, code tái sử dụng và ranh giới phụ thuộc. |
| `tests/`    | Ánh xạ yêu cầu → AC → test, fixtures và điều kiện chạy runner.                |
| `security/` | Phân loại dữ liệu, trust boundaries, STRIDE, abuse cases và biện pháp xử lý.  |
| `review/`   | Báo cáo review độc lập thật và đường dẫn bằng chứng.                          |
| `release/`  | Rollout, migration, rollback và bằng chứng bàn giao.                          |

Mỗi section trong plan modular phải dẫn hồ sơ tương ứng:

```markdown
## Module: identity

Artifacts: .verid/artifacts/03-modules/identity
Review Focus: xử lý lỗi và ranh giới phân quyền.

- AC-1: thông tin hợp lệ mở workspace của thành viên (REQ-1)
- AC-2: thông tin không hợp lệ trả lỗi chung đã thống nhất (REQ-2, SEC-1)
```

ID yêu cầu và AC phải duy nhất toàn project. Giải quyết các câu hỏi trong bản nháp
trước order. Chữ ký module gồm section plan và sáu tài liệu đầu vào thuộc
BA/UI/spec/tests/security. Sửa đầu vào cần order lại; review và release là đầu ra
nên không làm thay đổi chữ ký này.

[Hướng dẫn modular cook](docs/modular-cook.md) có đầy đủ template và luồng thực hiện.

---

## Bố cục repository

### Một Git repository

```text
your-project/                  # .git/
├── src/
├── test/
├── .verid/
├── AGENTS.md
├── CLAUDE.md                  # khi chọn Claude Code
├── .claude/
├── .agents/                   # entry skills Codex khi dùng tài nguyên repo
└── .codex/
```

Commit tài liệu project và chỉ dẫn chung đã tạo cùng source code.

### Nhiều repository trong một workspace

```text
workspace/                     # cấp này không có .git/
├── api/                       # .git/
├── web/                       # .git/
├── .verid/                    # repo harness chung, có .git/ riêng
├── AGENTS.md                  # tạo lại theo từng máy
├── CLAUDE.md                  # tạo lại theo từng máy, khi chọn Claude
├── .claude/
├── .agents/
└── .codex/
```

Mỗi repo trong manifest có path, globs và runner riêng. Workspace dùng chung một
vòng TDD. Chạy cook và mở provider tại gốc workspace để thấy tất cả repo.

### Những gì nằm trong .verid

Cây dưới đây dùng `modular` với tài nguyên `repo`. File tích hợp provider được tạo
theo provider đã chọn; hồ sơ module xuất hiện sau `verid module`.

```text
.verid/
├── manifest.yaml
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
├── hooks/                     # bundle runtime được pin
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

---

## Lệnh

| Lệnh                                  | Công dụng                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `verid cook`                          | Xem trước và thiết lập project, hoặc nối hook cho project vừa clone.      |
| `verid upgrade [--dry-run] [--yes]`   | Cập nhật wiring, chỉ dẫn provider và bổ sung defaults manifest còn thiếu. |
| `verid module <tên>`                  | Tạo hồ sơ modular từ template của project.                                |
| `verid doctor`                        | Kiểm tra cài đặt, provider, tài nguyên và audit.                          |
| `verid menu`                          | Xem tiến độ module và bước tiếp theo.                                     |
| `verid peek`                          | Xem trạng thái TDD hiện tại.                                              |
| `verid stock`                         | Ghi các lỗi có trước trong remix.                                         |
| `verid taste`                         | Chạy test và ghi bằng chứng.                                              |
| `verid order [module]`                | Duyệt module trong human drive; ký hoặc tiếp tục auto drive.              |
| `verid serve <module>`                | Đóng module khi coverage, bằng chứng mới và review đều đạt.               |
| `verid menu --commits --file`         | Tạo gói review.                                                           |
| `verid garnish`                       | Bắt đầu phiên chỉ refactor.                                               |
| `verid halt [lý-do]` / `verid resume` | Dừng lệnh gọi tool của agent hoặc tiếp tục.                               |
| `verid setup-codex`                   | Thiết lập reviewer đã cài trong config Codex của user.                    |

Cook, upgrade, stock, order, serve, garnish, halt và resume do developer chạy ở
terminal của mình. Agent dùng taste, menu, peek và doctor. Với auto drive đã ký,
harness tự quản lý việc mở và đóng module.

### Flags của cook

```sh
verid cook --mode prep --workflow modular --resources repo --provider codex --lang vi --yes
```

| Flag                                         | Giá trị hoặc tác dụng                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `--mode`                                     | `prep`, `recipe` hoặc `remix`.                                           |
| `--workflow`                                 | `classic` hoặc `modular`.                                                |
| `--resources`                                | `installed` hoặc `repo`.                                                 |
| `--provider`                                 | `claude-code` hoặc `codex`; lặp flag để chọn cả hai.                     |
| `--drive`                                    | `human` hoặc `auto` cho prep/recipe.                                     |
| `--architecture`                             | `ddd`, `clean`, `layered` hoặc `none`.                                   |
| `--layout`                                   | `monorepo` hoặc `workspace`; bỏ trống để tự nhận diện.                   |
| `--lang`                                     | `en` hoặc `vi`; ngôn ngữ CLI trên máy này.                               |
| `--test-cmd`                                 | Lệnh riêng có `{junit}` hoặc `VERID_JUNIT`.                              |
| `--src` / `--tests`                          | Globs source và test; có thể lặp flag.                                   |
| `--iterations`                               | Bật lịch iteration; đi kèm duration, ngày bắt đầu và ngày demo bên dưới. |
| `--duration` / `--start-date` / `--demo-day` | Ví dụ `"2 weeks"`, `2026-11-09`, `Sunday`.                               |
| `--dry-run`                                  | Xem kế hoạch, không ghi file.                                            |
| `--yes`                                      | Nhận defaults được gợi ý và bỏ qua xác nhận.                             |

Lịch iteration trong màn hình tương tác dùng 14 ngày, demo vào ngày cuối.
Metadata lịch không đổi thứ tự AC hay gate TDD.

Nếu có manifest, cấu hình trong đó được ưu tiên hơn các flag setup. Developer
chỉnh manifest để đổi lựa chọn rồi chạy cook lại. Khi chuyển sang tài nguyên repo,
đổi các role Claude từ `verid:<name>` thành `verid-<name>`.
Tên reviewer Codex vẫn là `verid_reviewer`.

### Xem trước khi ghi

```sh
verid cook --mode prep --workflow modular --resources repo --provider codex --dry-run
```

Bản xem trước hiện cây file: `+` tạo mới, `~` cập nhật, `=` giữ lại, `!` là ghi chú.
Xác nhận để áp dụng kế hoạch đã kiểm tra. Nội dung chỉ dẫn có sẵn nằm ngoài cặp
`<!-- verid:begin -->` và `<!-- verid:end -->` được giữ nguyên.

---

## Một module đi qua workflow như thế nào?

| Bước          | Người thực hiện và kết quả                                                        |
| ------------- | --------------------------------------------------------------------------------- |
| Research      | Main với BA đọc `.verid/docs/`, ghi phạm vi và nguồn.                             |
| Spec          | Main với BA ghi yêu cầu truy vết được trong `.verid/spec.md`.                     |
| Design        | Architect hoặc Codex main thống nhất interface và reuse trong `.verid/design.md`. |
| Plan          | Planner hoặc Codex main ghi AC theo thứ tự trong `.verid/plan.md`.                |
| Order         | Developer duyệt module; auto drive làm theo plan đã ký.                           |
| Build và test | Tester/QA rồi coder trên Claude; main trên Codex; mỗi vòng dùng `verid taste`.    |
| Review        | Reviewer mới đọc AC, design, hồ sơ module, diff và review packet.                 |
| Serve         | Bằng chứng, coverage AC và verdict phải đạt để đóng module.                       |
| Bàn giao      | Main chuẩn bị commits và PR sau các kiểm tra sản phẩm đã thống nhất.              |

### Mode và drive

| Mode     | Điểm bắt đầu  | Công việc đầu tiên                   |
| -------- | ------------- | ------------------------------------ |
| `prep`   | Ý tưởng       | Research, làm rõ, spec và design.    |
| `recipe` | Đặc tả có sẵn | Kiểm tra đầu vào rồi design và plan. |
| `remix`  | Code có sẵn   | Ghi baseline bằng `verid stock`.     |

`human` để developer order và serve. `auto` bắt đầu khi developer ký research,
spec và design bằng `verid order`. Harness review plan rồi làm từng module.
Câu hỏi chặn tiến độ được ghi vào `.verid/blocked.md`; developer xử lý rồi tiếp tục
bằng `verid order`.

### TDD và bằng chứng

| Trạng thái | Ghi test            | Ghi code production             | Bằng chứng tiếp theo                    |
| ---------- | ------------------- | ------------------------------- | --------------------------------------- |
| RAW        | Được                | Bị khóa                         | Assertion fail mới mở quyền triển khai. |
| RAW · stub | Được                | Stub để test chạy đến assertion | Assertion fail chuyển sang COOKING.     |
| COOKING    | Đóng băng           | Triển khai tối thiểu            | Test pass chuyển sang PLATED.           |
| PLATED     | Sửa test mở lại RAW | Refactor                        | Chạy taste lại sau thay đổi.            |

Tên test có mã `AC-n`. Chỉ `verid taste` cung cấp bằng chứng cho gate; lệnh test
khác giúp chẩn đoán. Kết quả pass cần còn khớp với các file hiện tại. Main thêm
kết quả và AC tiếp theo vào log của module.

Stop hook giữ công việc chưa xong khi vòng còn fail, stub còn mở hoặc thay đổi chưa
được kiểm chứng. Reviewer chỉ đọc. File báo cáo hoặc template không thay thế lần
chạy test thật, verdict reviewer hay approval.

---

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

### Thiết lập Codex

Với project dùng tài nguyên repo:

1. Chạy cook với `--provider codex --resources repo`.
2. Mở Codex ở gốc project hoặc workspace.
3. Trust project và từng hook verid đã tạo qua `/hooks`.
4. Chạy `verid doctor` và xử lý các vấn đề setup.
5. Để main ghi test/code; gọi `verid_reviewer` với `fork_turns: "none"` khi review.

Cook thêm `.codex/config.toml` theo project, trỏ reviewer đến
`../.verid/agents/verid-reviewer.toml`. Overlay này đọc skills trong repo và dùng
sandbox read-only. Chế độ repo không sửa config Codex của user.

Với `resources: installed`, cook thiết lập user reviewer và dùng đường dẫn skills
đã cài. Cả hai cách đều cần người dùng trust trong Codex.

Hook trong repo có test tích hợp cho order, RED/GREEN, review chỉ đọc và hết hiệu
lực approval sau khi sửa spec module. Kiểm tra offline với Codex CLI `0.166.0`
cũng xác nhận input mà model nhìn thấy có chỉ dẫn project và skills repo.
Xem [ghi chú kiểm chứng](docs/modular-cook.md#dùng-với-codex).

### Bảo vệ và audit

Hook bảo vệ runtime state, bí mật, định nghĩa provider, bundle hook và block chỉ dẫn.
Nó kiểm tra approval module, vòng TDD và vai trò ghi. Các lệnh Codex được hỗ trợ
gồm `apply_patch`, shell và gọi reviewer.

Coverage spec, thứ tự phụ thuộc, quy ước kiến trúc và danh sách dispatch đã biết
còn tạo cảnh báo tham khảo. Xem [bảng rule hook đầy đủ](docs/hook-reference.vi.md)
để biết mã rule và cách override. Ngoại lệ một lần gọi cần developer trực tiếp
trong Claude Code.

---

## Ví dụ manifest

Ví dụ dùng workflow modular, tài nguyên repo và Codex:

```yaml
schemaVersion: 1
mode: prep
workflow: modular
resources: repo
providers: [codex]
architecture: ddd
layout: monorepo
drive: human
allowed_skills: []
allowed_agents: []
roles:
  reviewer: [verid_reviewer]
repos:
  - path: .
    source_globs: ["**"]
    test_globs: ["**/test/**", "**/*.test.*"]
    ignore_globs: ["**/*.md", "**/*.json", "**/*.yaml", ".verid/**", ".agents/**", ".codex/**"]
```

Cook tạo defaults đầy đủ hơn theo runner và quy ước file đã nhận diện. Globs test
được ưu tiên hơn ignore và source. Runner tùy chỉnh phải ghi JUnit vào `{junit}`
hoặc đường dẫn trong biến môi trường `VERID_JUNIT`. Chỉ developer sửa manifest.

---

## Làm việc cùng thành viên mới

Sau khi clone project, cài CLI và chạy `verid cook` tại gốc project hoặc workspace.
Lựa chọn trong manifest và tài nguyên repo đã có được giữ lại; cook thêm file setup
còn thiếu và nối lại hook cho máy hiện tại.

Với workspace nhiều repo, chia sẻ repository `.verid`. Cook có thể clone repo
còn thiếu từ remote đã cấu hình trong manifest. Với monorepo, commit entry provider
và chỉ dẫn cùng source repo; với workspace, tạo lại các entry ở gốc theo từng máy.

## Nâng cấp

```sh
npm install -g @anhtranhai835/verid
verid upgrade --dry-run
verid upgrade --yes
verid doctor
```

Nếu cài từ source, cập nhật checkout, build rồi cài lại trước.
Upgrade cập nhật wiring và chỉ dẫn provider, thêm defaults còn thiếu đã được chấp
nhận. Tài nguyên repo và hồ sơ module đã có được giữ lại. Để làm mới tài nguyên
được pin, xem diff rồi thay các bản cần cập nhật.

---

## Phát triển

```sh
npm ci
npm run typecheck
npx prettier --check .
npm test
npm run test:full
```

[CI Windows](.github/workflows/ci.yml) chạy typecheck, format và toàn bộ test,
gồm kiểm thử installer. `npm test` bỏ qua bộ end-to-end của installer.

## Ghi nhận

Cấu trúc README và cách trình bày workspace tham khảo
[Haren](https://github.com/odarino/haren). Workflow đóng gói trong verid còn tham khảo
[superpowers](https://github.com/obra/superpowers) và
[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills).
Nguồn ghi nhận chi tiết nằm trong license của từng skill.

## Giấy phép

MIT. Xem [LICENSE](LICENSE).
