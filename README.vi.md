```
 ██╗   ██╗ ███████╗ ██████╗  ██╗ ██████╗
 ██║   ██║ ██╔════╝ ██╔══██╗ ██║ ██╔══██╗
 ██║   ██║ █████╗   ██████╔╝ ██║ ██║  ██║
 ╚██╗ ██╔╝ ██╔══╝   ██╔══██╗ ██║ ██║  ██║
  ╚████╔╝  ███████╗ ██║  ██║ ██║ ██████╔╝
   ╚═══╝   ╚══════╝ ╚═╝  ╚═╝ ╚═╝ ╚═════╝
     hook-enforced TDD for Claude Code and Codex · RAW → COOKING → PLATED
```

# verid: TDD cho Claude Code và Codex

[English](README.md) · **Tiếng Việt**

verid giúp coding agent làm việc theo TDD với hook kiểm soát lần ghi.
Nó ghi bằng chứng test trước khi cho phép triển khai và giữ audit log.
Developer duyệt module, ngoại lệ và bản bàn giao cuối.

## Cài đặt

Cần Node.js 22+ và Claude Code hoặc Codex CLI.

Windows: `irm https://raw.githubusercontent.com/anhtranhai835/verid/main/install.ps1 | iex` (PowerShell). macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/anhtranhai835/verid/main/install.sh | sh`.

Hoặc cài bằng `npm install -g @anhtranhai835/verid`. Với Claude Code, thêm marketplace `anhtranhai835/verid` rồi cài `verid@verid`. Sau khi nâng cấp hoặc chuyển chỗ cài đặt, chạy `verid upgrade --yes` trong mỗi project.

## Bắt đầu nhanh

Chạy `verid cook` trong project; chọn provider, ngôn ngữ, mode, kiến trúc và drive. Đặt tài liệu nguồn vào `.verid/docs/`. Với remix, chạy `verid stock` trước khi agent sửa code. Mở provider và giao việc; `verid menu` cho biết bước tiếp theo.

Commit `.verid/manifest.yaml`, `.verid/.gitignore`, `.verid/rules/`, `.verid/docs/`, `.verid/log/`, `AGENTS.md`, `CLAUDE.md` khi có, và tài liệu research, spec, design, plan trong prep hoặc recipe. Giữ `.claude/settings.local.json` và `.codex/hooks.json` riêng trên mỗi máy.

## Từ nguyên liệu đến lên món (Workflow)

Chọn nguyên liệu (Research) → Viết công thức (Spec) → Phác món (Design) → Lên thực đơn (Plan) → Gọi món (Order) → Vào bếp và nếm thử (Build and Test) → Kiểm món (Review) → Bưng món (Serve) → Bàn giao (Commit, push, PR). Bưng xong một món thì gọi món tiếp theo cho module kế tiếp.

| Bước trong bếp                      | Người thực hiện                        | Kết quả                                                                                                               |
| :---------------------------------- | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| Chọn nguyên liệu (Research)         | luồng chính, `verid:ba`                | Đọc tài liệu nguồn trong `.verid/docs/`; ghi phạm vi vào `.verid/research.md`.                                        |
| Viết công thức (Spec)               | luồng chính, `verid:ba`                | Ghi yêu cầu có nguồn vào `.verid/spec.md`.                                                                            |
| Phác món (Design)                   | architect                              | Thống nhất interface và phụ thuộc trong `.verid/design.md`.                                                           |
| Lên thực đơn (Plan)                 | planner                                | Ghi module theo thứ tự và AC có thể kiểm thử vào `.verid/plan.md`.                                                    |
| Gọi món (Order)                     | developer ở human drive                | `verid order <module>` duyệt một module. Auto mở theo thứ tự file; `Depends:` nêu module phụ thuộc.                   |
| Vào bếp và nếm thử (Build and Test) | tester hoặc QA, rồi coder              | Làm assertion của AC fail, triển khai, `verid taste` pass, refactor; luồng chính ghi AC vào `.verid/log/<module>.md`. |
| Kiểm món (Review)                   | reviewer, rồi security nếu được ánh xạ | Đọc `verid menu --commits --file`; mỗi báo cáo kết thúc bằng `Verdict: pass` hoặc `Verdict: fail`.                    |
| Bưng món (Serve)                    | developer ở human drive; auto tự đóng  | `verid serve <module>` cần AC được phủ, test pass còn hiệu lực và review đạt.                                         |
| Bàn giao (Handoff)                  | luồng chính                            | Sau `product`, commit, push và mở PR.                                                                                 |

## Vòng nấu (TDD cycle)

Hook xét quyền ghi theo đường dẫn file và vai trò. `verid taste` chạy bộ test đã cấu hình, đối chiếu exit code với JUnit và ghi trạng thái vòng; chạy test ngoài lệnh này chỉ giúp chẩn đoán.

| Trạng thái | Ghi test         | Ghi code production       | Kết quả taste                                                             |
| :--------- | :--------------- | :------------------------ | :------------------------------------------------------------------------ |
| RAW        | được             | bị khoá                   | Assertion mới fail → COOKING; test không load → RAW · stub; pass vẫn RAW. |
| RAW · stub | được             | chỉ stub để tới assertion | Assertion fail → COOKING; pass → RAW.                                     |
| COOKING    | đóng băng        | triển khai tối thiểu      | Fail vẫn COOKING; pass → PLATED.                                          |
| PLATED     | được, mở lại RAW | chỉ refactor              | Fail → COOKING; pass vẫn PLATED.                                          |

Tên test phải có mã AC. Luồng chính đọc báo cáo agent và thêm một entry có ngày cho từng AC vào `.verid/log/<module>.md`; agent không ghi log. Ghi test mở lại RAW, và chỉ assertion fail mới trong RAW mới mở quyền triển khai. Phiên mới bắt đầu ở RAW; `verid garnish` mở phiên chỉ refactor.

`Stop` giữ luồng chính ở COOKING, khi stub còn mở hoặc lần ghi chưa được taste xác nhận; ở human drive còn giữ một lần mỗi phiên vì AC chưa phủ hoặc chờ review. `SubagentStop` cho tester/QA bàn giao test fail hoặc stub đã ghi nhận cho coder, nhưng giữ người ghi khi thay đổi mới nhất chưa qua taste. Mỗi lần giữ chỉ phát ra một lần; auto drive còn tự quản lý điểm dừng theo tiến độ.

## Mode và drive

| Mode     | Điểm bắt đầu | Công việc                                          |
| :------- | :----------- | :------------------------------------------------- |
| `prep`   | ý tưởng      | research, spec, design, plan, module               |
| `recipe` | đặc tả       | design, plan, module                               |
| `remix`  | code sẵn có  | `verid stock` ghi lỗi cũ; build dùng cùng vòng TDD |

`drive: human` để developer order và serve. `drive: auto` ký research, spec và design một lần, review plan rồi tự order và serve module theo thứ tự file; trở ngại ghi vào `.verid/blocked.md`, developer tiếp tục bằng `verid order`. Iteration tuỳ chọn chỉ hỗ trợ lịch, không đổi cổng chặn.

## Provider

`AGENTS.md` là nguồn chỉ dẫn chung; `CLAUDE.md` import bằng `@AGENTS.md`. `verid cook` và `verid upgrade` giữ block có đánh dấu trong `AGENTS.md`; `verid doctor` kiểm cả hai file. Hook thực thi luật độc lập với các chỉ dẫn này.

Claude Code có thể tách tester, coder, QA, reviewer và security qua `roles`. Codex dùng luồng chính viết cả test và code, còn `verid_reviewer` chỉ đọc; hãy tin cậy project và hook trong `/hooks` trước khi làm việc. Chỉ developer trực tiếp trên Claude Code mới cấp ngoại lệ cho một lần gọi bằng `/verid tip`.

## Bố cục

`monorepo` có một cây Git. `workspace` có nhiều repo con và repo `.verid/` chung; mỗi repo có glob và runner riêng nhưng cùng một vòng TDD. `CLAUDE.md` và `AGENTS.md` của workspace ở gốc workspace, riêng cho mỗi máy; `verid cook` tạo lại sau khi clone.

## Quy ước và audit

- **Spec và phụ thuộc:** AC dẫn mã REQ/NFR/SEC; `Depends:` nêu module cần có trước. Mã thiếu hoặc lạ và thứ tự phụ thuộc chỉ cảnh báo.
- **Kiến trúc và màn hình:** `.verid/rules/architecture.md`, các rule project và `architecture_check` là chỉ dẫn không chặn. Wireframe `Screens:` của module dẫn test e2e và review.
- **Session log và review:** Luồng chính thêm quyết định, bằng chứng, sai lệch và AC tiếp theo vào `.verid/log/<module>.md`. Gói review `.verid/review/work.md` là snapshot; tạo lại sau khi sửa.
- **Git:** `.verid/rules/git.md` mô tả Conventional Commits và bàn giao PR. Audit Git chỉ cảnh báo; commit không chặn việc đóng module.

## Lệnh

| Lệnh                                           | Công dụng                                                           |
| :--------------------------------------------- | :------------------------------------------------------------------ |
| `verid cook`, `verid upgrade`                  | Cài hoặc cập nhật hook và chỉ dẫn của project.                      |
| `verid doctor`, `verid menu`, `verid peek`     | Kiểm cài đặt và audit, bước tiếp theo hoặc trạng thái vòng.         |
| `verid stock`, `verid taste`                   | Ghi baseline remix hoặc chạy test làm bằng chứng.                   |
| `verid order [module]`, `verid serve <module>` | Developer duyệt và đóng trong human drive; order còn tiếp tục auto. |
| `verid garnish`, `verid halt`, `verid resume`  | Phiên chỉ refactor, dừng khẩn cấp hoặc tiếp tục.                    |
| `verid menu --commits --file`                  | Ghi gói review.                                                     |

## Hook chặn gì

| Rule                                 | Override được       | Phạm vi                                                                                                                                                                                                                                                                                                                                |
| :----------------------------------- | :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERID_BURNT_STATE_PROTECTED`        | không               | đọc hoặc ghi `.verid/.state/`, ghi `.verid/review/`                                                                                                                                                                                                                                                                                    |
| `VERID_BURNT_HALTED`                 | không               | mọi lệnh gọi tool trong lúc developer đã chạy `verid halt`                                                                                                                                                                                                                                                                             |
| `VERID_BURNT_SECRET_PROTECTED`       | không               | file bí mật: `.env*` (trừ file mẫu), key, chứng chỉ, `.ssh/`, `.npmrc`…                                                                                                                                                                                                                                                                |
| `VERID_BURNT_TRANSCRIPT_PROTECTED`   | không               | transcript của Claude Code trong `~/.claude/projects/` hay `CLAUDE_CONFIG_DIR/projects/`                                                                                                                                                                                                                                               |
| `VERID_BURNT_HOOK_PROTECTED`         | không               | ghi `.claude/settings*.json`, mọi `.claude.json` hay `.mcp.json` (danh sách MCP server), `.claude/agents/`, `.claude/plugins/` của project/home, `.claude/skills/` của project / `~/.claude/skills/` và `.claude/commands/` / `~/.claude/commands/`, các đường dẫn tương ứng trong `CLAUDE_CONFIG_DIR`, `dist/` và `plugin/` của verid |
| `VERID_BURNT_MANIFEST_PROTECTED`     | có                  | ghi `.verid/manifest.yaml`                                                                                                                                                                                                                                                                                                             |
| `VERID_BURNT_DOCS_PROTECTED`         | có                  | ghi vào `.verid/docs/`, tài liệu của developer                                                                                                                                                                                                                                                                                         |
| `VERID_BURNT_INSTRUCTIONS_PROTECTED` | có                  | đổi hoặc xoá block verid trong file chỉ dẫn của provider                                                                                                                                                                                                                                                                               |
| `VERID_BURNT_PATCH_UNSUPPORTED`      | không trên Codex    | `apply_patch` sai cú pháp hay cú pháp lạ, gồm định tuyến environment, hoặc patch đưa qua shell                                                                                                                                                                                                                                         |
| `VERID_BURNT_TOOL_UNSUPPORTED`       | không trên Codex    | tool Codex không phải MCP và ngoài danh sách hỗ trợ; thông báo nêu tên tool                                                                                                                                                                                                                                                            |
| `VERID_BURNT_AGENT_CONTEXT`          | không trên Codex    | gọi reviewer với `fork_turns` khác `"none"`                                                                                                                                                                                                                                                                                            |
| `VERID_BURNT_BASH_NESTED_CODEX`      | có trên Claude Code | shell mở một phiên `codex` lồng                                                                                                                                                                                                                                                                                                        |
| `VERID_BURNT_BASH_NESTED_CLAUDE`     | có                  | Bash mở một phiên `claude` lồng                                                                                                                                                                                                                                                                                                        |
| `VERID_BURNT_BASH_DEVELOPER_ONLY`    | có                  | Bash nhắc tới `CLAUDECODE` hay hook của verid, hoặc chạy lệnh của developer                                                                                                                                                                                                                                                            |
| `VERID_BURNT_BASH_DANGEROUS`         | có                  | tải hay giải mã code rồi chạy ngay trong một lệnh (`curl …                                                                                                                                                                                                                                                                             | sh`, `bash <(curl …)`, `irm … | iex`, `base64 -d | sh`, `powershell -enc`), `git --no-verify`hay`core.hooksPath`, `sudo`, `doas`, RunAs, và `chmod` setuid/setgid |
| `VERID_BURNT_SHELL_UNSUPPORTED`      | có trên Claude Code | shell không hỗ trợ của Claude Code, hay dạng PowerShell động của Codex không đọc được lệnh                                                                                                                                                                                                                                             |
| `VERID_BURNT_ROLE_READ_ONLY`         | có                  | mọi lần ghi của reviewer hay security reviewer đã ánh xạ                                                                                                                                                                                                                                                                               |
| `VERID_BURNT_ROLE_TESTER_ONLY`       | có                  | khi tách: test do người khác ngoài tester ghi, trừ qa ghi test end-to-end                                                                                                                                                                                                                                                              |
| `VERID_BURNT_ROLE_CODER_ONLY`        | có                  | khi tách: code production do người khác ngoài coder ghi                                                                                                                                                                                                                                                                                |
| `VERID_BURNT_PLAN_NOT_APPROVED`      | có                  | code production khi không có module nào đang mở (prep, recipe)                                                                                                                                                                                                                                                                         |
| `VERID_BURNT_AUTO_NO_MODULE`         | có                  | auto: code production khi không có module nào đang mở                                                                                                                                                                                                                                                                                  |
| `VERID_BURNT_AUTO_STUCK`             | có                  | auto: code production và test khi drive đang kẹt                                                                                                                                                                                                                                                                                       |
| `VERID_BURNT_TDD_NO_FAILING_TEST`    | có                  | code production khi vòng đang ở RAW                                                                                                                                                                                                                                                                                                    |
| `VERID_BURNT_TDD_TEST_FROZEN`        | có                  | test khi vòng đang ở COOKING                                                                                                                                                                                                                                                                                                           |
| `VERID_BURNT_GIT_INTERNALS`          | không               | mọi thao tác ghi bên trong thư mục `.git` của repository: ref, cấu hình, hook                                                                                                                                                                                                                                                          |

Các rule áp dụng cho tool file, Bash (đích ghi rõ ràng được xét như Write), tool MCP, `Skill`, `Agent`, `Task` của Claude Code, cùng `apply_patch` và `collaborationspawn_agent` của Codex. Codex còn bảo vệ `.codex/` trong project/home, `.agents/skills/` trong project/home và thư mục `plugin/` của verid, coi `~/.codex/sessions/`, `history.jsonl` và các database trạng thái của nó là transcript và `~/.codex/auth.json` là bí mật, kể cả khi chuyển `CODEX_HOME`. Lỗi bất ngờ bên trong verid chặn lần gọi đó.

Vai trò: khi có tester và coder, chỉ coder viết code production và chỉ tester (hoặc qa, với test end-to-end) viết test; luồng chính và agent lạ không giành được quyền nào trong hai quyền đó. Reviewer và security không ghi gì. Phạm vi của các vai soạn thảo (architect, planner, qa) và danh sách skill/agent được biết là chỉ dẫn: chỗ lệch được audit, không bị chặn. Một vai cần định danh subagent do host cung cấp.

## manifest.yaml

```yaml
schemaVersion: 1
mode: prep # prep | recipe | remix
providers: [claude-code, codex]
drive: human # human | auto
layout: monorepo # monorepo | workspace
allowed_skills: []
allowed_agents: []
roles:
  reviewer: ["verid:reviewer", "verid_reviewer"]
  tester: ["verid:tester"]
  coder: ["verid:coder"]
repos:
  - path: .
    source_globs: ["**"]
    test_globs: ["**/test/**", "**/*.test.*"]
```

Glob test ưu tiên hơn ignore và source. Developer sửa manifest; `verid cook` điền giá trị mặc định. `allowed_skills: ["superpowers:*"]` và `allowed_agents` tuỳ chọn mở rộng dispatch; `roles` đã ánh xạ và cổng TDD vẫn quyết định quyền ghi. `roles.researcher` đã bỏ; dùng `verid:ba` ở luồng chính.

## Phát triển

`npm run typecheck`, `npx prettier --check .`, `npm test`; CI Windows còn chạy `npm run test:full` trong [ci.yml](.github/workflows/ci.yml).

## Ghi nhận

verid tham khảo [superpowers](https://github.com/obra/superpowers) và [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills). Nguồn chi tiết có trong license của từng skill.

## Giấy phép

MIT. Xem [LICENSE](LICENSE).
