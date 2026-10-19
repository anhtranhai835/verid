# ADR-0007: Override hai bước, chỉ nhận từ phiên có người

- Trạng thái: Accepted, 2026-10-19

## Bối cảnh
Developer cần một cách vượt một lần một hành động bị chặn. Agent không được tự tạo ra quyền đó. Các spike ở Phase 0 (Claude Code 2.1.300, Windows) cho thấy:
- `UserPromptSubmit` nhận nguyên văn `/verid allow x`, dù có hay không có `.claude/commands/verid.md`.
- Prompt gửi cho subagent không kích hoạt `UserPromptSubmit`. Tool call của subagent mang `agent_id`.
- Agent có thể chạy `claude -p` từ Bash, kể cả `--resume <session_id>` của phiên cha. Vì vậy gắn override theo session không đủ.
- `CLAUDECODE=1` có ở mọi phiên, nên không dùng làm dấu hiệu được. `CLAUDE_CODE_SESSION_ATTENDED` bằng `1` khi có người gõ, bằng `0` với `claude -p`. Claude Code tự tính giá trị này: agent đặt sẵn `=1` hay xoá biến đi đều không đổi được kết quả.
- Thông báo chặn ở `UserPromptSubmit` (exit 2 + stderr) chỉ hiện cho developer, không vào ngữ cảnh của agent. Tuy vậy nó vẫn được ghi vào file transcript trên đĩa.

## Quyết định
- `/verid allow <lý do>` chặn prompt và chỉ hiện cho developer một **cảnh báo rủi ro** kèm **mã xác nhận ngẫu nhiên**. Bước này chưa tạo override.
- `/verid confirm <mã>` tạo **một** override gắn với hành động bị chặn gần nhất `{session, rule, tool, input_hash}`. Override bị tiêu thụ ngay lần đầu hành động đó được cho qua.
- Cả hai lệnh chỉ được nhận khi `CLAUDE_CODE_SESSION_ATTENDED === "1"` **và** payload không có `agent_id`.
- Lớp phụ: chặn Bash gọi `claude`. Agent không được đọc `.verid/.state/**` (nơi lưu mã đang chờ) và transcript `~/.claude/projects/**`. Cả hai là bất biến, không override được.
- Bất biến (state, file bí mật, transcript) không bao giờ nhận override.

## Lựa chọn thay thế
- Một bước `/verid allow`: không có lúc nào developer phải chủ động chấp nhận rủi ro.
- Cờ `--accept-risk`: cố định, gõ quen tay thì cảnh báo thành hình thức.
- Hộp thoại xin quyền của Claude Code (`ask`): ở auto mode có thể bị tự duyệt, và đi ngược quyết định Q2.
- Dựa vào `CLAUDECODE`: đo được là luôn bằng 1.

## Hệ quả
- `CLAUDE_CODE_SESSION_ATTENDED` là biến nội bộ, không có trong tài liệu. Nếu Claude Code đổi tên biến này, override sẽ ngừng hoạt động (vẫn an toàn). Có test e2e cho trường hợp này, và `doctor` (Phase 5) phải kiểm tra.
- Không bao giờ override được trong `claude -p`.
- Agent tự cài công cụ pty để giả TTY: chưa bị chặn, thuộc allowlist Bash ở Phase 4.
