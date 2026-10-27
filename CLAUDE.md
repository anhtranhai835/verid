# verid: hướng dẫn khi làm việc trên repo này

verid là harness TDD cho Claude Code và Codex. Mọi thay đổi đều theo ba hướng dưới đây.

## 1. superpowers: quy trình, gọi chứ không cài

- Vòng TDD của verid là skill `superpowers:test-driven-development` (RED → GREEN → REFACTOR, "no production code without a failing test first"), cùng với "evidence before claims" của `superpowers:verification-before-completion`.
- Lớp prompt của verid **gọi** các skill `superpowers:*` từ plugin superpowers mà developer tự cài. Không copy, không đóng gói, không vendor skill của superpowers vào verid hay vào project của người dùng.
- verid có plugin riêng (agent tester, coder, reviewer và một skill cho mỗi bước); skill của plugin gọi skill superpowers chứ không chép; agent khác thay được qua bảng `roles`; verid không ghi agent vào project của người dùng.

## 2. Nhẹ, nhưng hook và gate phải chặt

- Nhẹ: verid không viết lại, copy hay đóng gói skill và agent đã có sẵn (superpowers, agent của plugin public) mà gọi chúng. Nhiều bước, nhiều cổng vẫn được, miễn không nặng vô cớ. Project của người dùng chỉ có `.verid/`, `.claude/commands/verid/`, `.claude/settings.local.json`, `.codex/hooks.json` và block giữa `<!-- verid:begin -->` / `<!-- verid:end -->` trong `CLAUDE.md` hoặc `AGENTS.md` theo provider; phần ngoài block thuộc người dùng. Không ghi skill hay agent vào project. Trên máy, verid ghép block có dấu `[agents.verid_reviewer]` vào `~/.codex/config.toml` (hay `$CODEX_HOME/config.toml`), trỏ tới overlay đi kèm bản cài và giữ nguyên TOML còn lại.
- Ngoại lệ duy nhất (developer, 2026-10-25): skill `verid:security` (cùng file tham chiếu) và `verid:edge-cases` của plugin được chép và chỉnh từ ClaudeKit để verid tự chạy được trên máy không có ClaudeKit; chúng không gọi hay nêu tên skill ClaudeKit nào, và không ghi license hay attribution.
- Chặt: hook là lớp ép buộc, không phải lời khuyên. Gặp lỗi bên trong verid thì fail-closed. Agent không được vượt gate. Muốn ngoại lệ thì chỉ developer mở được bằng `/verid tip` trên Claude Code, và audit ghi lại; Codex không tạo override.
- Cả Claude Code và Codex có hook; Codex dùng JSON để từ chối và giữ Stop, luồng chính viết test lẫn code qua cổng TDD, reviewer chỉ đọc. Mức ép buộc phải chặt nhất trong khả năng host, phải ghi rõ giới hạn fail-open và hook chưa tin cậy của Codex, không hứa Codex ngang Claude Code. Agent có allowlist; allowlist skill chỉ là chỉ dẫn trên Codex vì không có hook kích hoạt. Block chỉ dẫn được bảo vệ; các bảo vệ mới chỉ thêm lần từ chối, không thu hẹp rule có sẵn.
- Mỗi giới hạn mà hook chưa chặn được phải nằm trong mục "Limitations" của `README.md` và mục "Giới hạn" của `README.vi.md`.

## 3. Bốn tiêu chí của karpathy-guidelines

- **Think Before Coding**: nói rõ giả định; có nhiều cách hiểu thì hỏi, không tự chọn.
- **Simplicity First**: code tối thiểu đủ giải quyết vấn đề, không có gì "để sau dùng".
- **Surgical Changes**: chỉ đụng tới thứ cần đụng, giữ nguyên style hiện có.
- **Goal-Driven Execution**: biến việc cần làm thành tiêu chí kiểm chứng được (test fail trước, rồi pass).

## README

Phần cảm hứng của README (cả hai bản) chỉ nêu hai nguồn: [superpowers](https://github.com/obra/superpowers) và [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills). Các project khác chỉ dùng để tham khảo thì không nhắc trong README.

## Quy ước

- Code: TypeScript strict, ESM, Prettier; tên file kebab-case, chỉ named export. `src/core` là hàm thuần, không I/O; lỗi dự kiến trả về dưới dạng giá trị, lỗi bất ngờ thành deny `VERID_BURNT_INTERNAL`. Mỗi mã `VERID_BURNT_<VÙNG>_<TÊN>` có key ở cả `i18n/vi.json` lẫn `i18n/en.json`.
- Test: Vitest. Mỗi `it` là một hành vi; các trường hợp của nó là một bảng literal bên trong `it` (không dùng `it.each`), expected là literal. E2E: mỗi event của hook (theo từng provider) và mỗi lệnh CLI chính giữ ít nhất một test spawn `dist/hook.js` / `dist/cli.js` thật; các bảng case còn lại gọi `run()` của hook và `runCli()` ngay trong process, qua `test/e2e/in-process.ts`. Không chép logic của hook vào test.
- Repo giữ gọn: `README.md` và bản dịch `README.vi.md` là tài liệu duy nhất, không có thư mục `docs/`. Sửa một bản thì sửa cả bản kia.
- Commit theo Conventional Commits và không nhắc tới AI.
- Làm trực tiếp trên nhánh `main` cho tới khi hoàn thành.
- Phát triển chính verid cũng theo TDD: viết test fail trước, xem nó fail, rồi mới viết code.
- Windows là nền tảng chính. Không có CI: chạy `npm test` trên Windows trước khi commit; khi đổi `install.ps1`, `install.sh` hay test của chúng thì chạy `npm run test:full`.
