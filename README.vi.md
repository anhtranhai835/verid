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
và kiểm tra approval; hook từ chối các lần ghi bỏ qua approval hoặc test đang fail.

---

## Vì sao dùng verid?

- **Lập kế hoạch theo module.** Mỗi module có AC kiểm thử được; developer quyết định khi bắt đầu.
- **Dùng bằng chứng đã ghi nhận.** `verid taste` đối chiếu exit code của runner với báo cáo JUnit.
- **Phân vai rõ ràng.** Test, code và review là các vai riêng, reviewer chỉ đọc.
- **Mang workflow theo repo.** Agents, skills, templates và bản hook runtime được pin có thể nằm trong project.
- **Tiếp tục dựa trên trạng thái thực.** `verid menu` cho biết tiến độ module, cảnh báo audit và bước tiếp theo.

---

## Bắt đầu nhanh

Cần Node.js 22 trở lên, Git, và Claude Code hoặc Codex. Các cách cài khác, cùng thiết lập Codex và Antigravity, nằm ở [cài đặt](docs/installation.vi.md).

**1. Cài.**

```sh
npm install -g @anhtranhai835/verid
```

**2. Thiết lập project.** Nhấn Enter ở mỗi câu hỏi: ngôn ngữ, mode (`prep` cho ý tưởng, `recipe` cho đặc tả có sẵn, `remix` cho code có sẵn) và, với prep và recipe, drive (`big-brain`: bạn chọn và duyệt từng task; `no-brain`: bạn gõ ý tưởng, agent lo phần còn lại). Cook hiện provider, layout, test runner tìm được và các file sẽ ghi; "Đổi thiết lập" để đổi phần còn lại.

```sh
cd your-project
verid cook
```

Dòng cuối là câu cần nói: `Mở Claude Code và nói: what's next?`. Với project `remix`, dòng ngay trên nhắc chạy `verid stock` trước.

**3. Nói "what's next?".** Mở Claude Code hoặc Codex ở gốc project và nói câu đó. Agent kiểm tra cài đặt (như `verid doctor`) và nêu bước tiếp theo; rồi mô tả ý tưởng. Agent đi qua `ba`, `design` và `plan`; `verid menu` cho biết đang ở đâu.

**4. Duyệt module.** Đọc module agent đã viết trong `.verid/plan.md`. Khi AC đúng, order nó.

```sh
verid order <module>
```

**5. Xem agent build.** Agent viết test fail trước, rồi code, giữa hai bước chạy `verid taste`. Vòng đi RAW, COOKING, PLATED.

```sh
verid peek
```

**6. Review và serve.** Reviewer mới kiểm tra module. Khi bằng chứng và review đều đạt, đóng module.

```sh
verid serve <module>
```

**Bị chặn?** Mỗi lần từ chối đều in mã và bước tiếp theo; xem [xử lý sự cố](docs/troubleshooting.vi.md).

---

## Một module đi qua workflow như thế nào?

| Bước          | Người thực hiện và kết quả                                                        |
| ------------- | --------------------------------------------------------------------------------- |
| Research      | Main với BA đọc `.verid/docs/`, ghi phạm vi và nguồn.                             |
| Spec          | Main với BA ghi yêu cầu truy vết được trong `.verid/spec.md`.                     |
| Design        | Architect hoặc Codex main thống nhất interface và reuse trong `.verid/design.md`. |
| Plan          | Planner hoặc Codex main ghi AC theo thứ tự trong `.verid/plan.md`.                |
| Order         | Developer duyệt module; no-brain drive làm theo plan đã ký.                       |
| Build và test | Tester/QA rồi coder trên Claude; main trên Codex; mỗi vòng dùng `verid taste`.    |
| Review        | Reviewer mới đọc AC, design, hồ sơ module, diff và review packet.                 |
| Serve         | Bằng chứng, coverage AC và verdict phải đạt để đóng module.                       |
| Bàn giao      | Main chuẩn bị commits và PR sau các kiểm tra sản phẩm đã thống nhất.              |

Bảng này là bản tóm tắt. Các bước đầy đủ nằm ở `.verid/workflow.md`. Với thay đổi nhỏ, xem [thay đổi nhỏ](docs/small-changes.vi.md).

---

## Lệnh

Với chế độ repo, chạy từng lệnh bằng `node .verid/verid.mjs <lệnh>` từ gốc project.
Cách viết gọn `verid` bên dưới dùng được khi chọn cài global.

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
| `verid order [module]`                | Duyệt module trong big-brain drive; ký hoặc tiếp tục no-brain drive.      |
| `verid serve <module>`                | Đóng module khi coverage, bằng chứng mới và review đều đạt.               |
| `verid menu --commits --file`         | Tạo gói review.                                                           |
| `verid garnish`                       | Bắt đầu phiên chỉ refactor.                                               |
| `verid halt [lý-do]` / `verid resume` | Dừng lệnh gọi tool của agent hoặc tiếp tục.                               |
| `verid setup-codex`                   | Thiết lập reviewer đã cài trong config Codex của user.                    |
| `verid setup-antigravity`             | Cài hoặc cập nhật plugin Antigravity của verid cho user này.              |

Cook, upgrade, stock, order, serve, garnish, halt và resume do developer chạy ở
terminal của mình. Agent dùng taste, menu, peek và doctor. Với no-brain drive đã ký,
harness tự quản lý việc mở và đóng module. Các flag của cook nằm ở [tham chiếu cook](docs/cook-reference.vi.md).

---

## Bố cục repository

Một Git repository:

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

Nhiều repository trong một workspace:

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

Commit tài liệu project và chỉ dẫn chung đã tạo cùng source code.
Với workspace, chạy cook và mở provider tại gốc workspace; mỗi repo trong manifest có
path, globs và runner riêng, và workspace dùng chung một vòng TDD.
`AGENTS.md` và `CLAUDE.md` ở gốc workspace là của mỗi máy; `verid cook` tạo lại chúng.
Cây `.verid/` đầy đủ nằm ở [provider và bảo vệ](docs/providers-and-protection.vi.md).

---

## Ví dụ manifest

Ví dụ dùng workflow modular, tài nguyên repo và Codex:

```yaml
schemaVersion: 1
mode: prep
resources: repo
providers: [codex]
architecture: ddd
layout: monorepo
drive: big-brain
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

Với skill bên ngoài, `allowed_skills: ["superpowers:*"]` thêm namespace đã biết;
`allowed_agents` thêm tên agent cụ thể. `roles` đã ánh xạ và gate TDD vẫn quyết định
quyền ghi. `roles.researcher` đã bỏ; dùng `verid:ba` ở luồng chính
(`verid-ba` khi dùng tài nguyên repo).

---

## Bảo vệ

Hook bảo vệ runtime state, bí mật, định nghĩa provider, bundle hook và block chỉ dẫn,
và kiểm tra approval module, vòng TDD và vai trò ghi.
Quy ước `.verid/rules/architecture.md` và kết quả `architecture_check` là chỉ dẫn
không chặn: doctor và menu hiển thị chúng. Mã rule và cách override nằm ở
[bảng rule hook](docs/hook-reference.vi.md).

## Tài liệu

- [Cài đặt và thiết lập](docs/installation.vi.md): các cách cài, thiết lập Codex và Antigravity, nâng cấp, chuyển từ 1.x.
- [Tham chiếu cook](docs/cook-reference.vi.md): flags, xem trước, mode và drive.
- [Module và board](docs/modules-and-board.vi.md): hồ sơ module, board trên trình duyệt, các trạng thái TDD.
- [Provider và bảo vệ](docs/providers-and-protection.vi.md): agents và skills, cây `.verid/`, làm việc cùng thành viên mới.
- [Xử lý sự cố](docs/troubleshooting.vi.md): các lần từ chối gặp đầu tiên.
- [Thay đổi nhỏ](docs/small-changes.vi.md) · [Board workflow](docs/kanban-workflow.md) · [Hướng dẫn modular cook](docs/modular-cook.md)

## Phát triển

```sh
npm ci
npm run typecheck
npx prettier --check .
npm test
npm run test:coverage
```

[CI](.github/workflows/ci.yml): typecheck, format, toàn bộ test có ngưỡng coverage trên Windows mỗi PR;
ở `main` và khi phát hành thêm Ubuntu (Node 22, 24) và macOS. `npm test` bỏ qua test installer.

## Ghi nhận

Workflow đóng gói trong verid tham khảo
[superpowers](https://github.com/obra/superpowers) và
[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills).
Nguồn ghi nhận chi tiết nằm trong license của từng skill.

## Giấy phép

Riêng tư, chỉ dùng nội bộ; không cấp phép phân phối lại. Skill đi kèm giữ giấy phép riêng của chúng.
