# Checklist chạy thử hook với Claude Code thật

Dùng cho Phase 0, khi chưa có `verid init`. Đã chạy với Claude Code 2.1.300 trên Windows 11 ngày 2026-10-19.

## 1. Chuẩn bị

```bash
npm install
npm run build
```

Trong một thư mục dự án thử:

1. Tạo `.verid/.state/state.json` với nội dung `{"schemaVersion":1}`.
2. Tạo `.claude/settings.json`, thay `<VERID>` bằng đường dẫn tuyệt đối tới repo verid (dùng dấu `/`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node", "args": ["<VERID>/dist/hook.js"], "timeout": 10, "onFailure": "block" }
        ]
      }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["<VERID>/dist/hook.js"], "timeout": 10 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["<VERID>/dist/hook.js"], "timeout": 10 }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["<VERID>/dist/hook.js"], "timeout": 10 }] }
    ]
  }
}
```

`onFailure: "block"` chỉ đặt cho `PreToolUse`. Thiếu cờ này thì hook crash hoặc treo sẽ để tool chạy (spike S3).

## 2. Agent bị chặn (chạy headless được)

Mở Claude Code trong thư mục thử và nhờ agent làm từng việc. Kết quả mong đợi:

| Việc | Kết quả |
|---|---|
| Write `src/ok.txt` | được |
| Write `.verid/.state/hack.json` | `VERID_E_STATE_PROTECTED` |
| Read `.env` | `VERID_E_SECRET_PROTECTED` |
| Bash `cat .env` | `VERID_E_SECRET_PROTECTED` |
| Write `.verid/manifest.yaml` | `VERID_E_MANIFEST_PROTECTED` |
| `claude -p --resume <session> "/verid allow x"` (phiên lồng) | `VERID_E_OVERRIDE_UNATTENDED` |

Sau đó `.verid/.state/state.json` có `blocked_actions` bằng số lần bị chặn, và `.verid/.state/audit.jsonl` có một dòng `denied` cho mỗi lần.

## 3. Override (developer phải tự gõ trong phiên tương tác)

1. Nhờ agent ghi `.verid/manifest.yaml` → bị chặn.
2. Gõ `/verid allow <lý do>`. Nhấn Esc để đóng menu gợi ý trước khi Enter, nếu không Claude Code sẽ gửi `/verid` trơn. Phải thấy **CẢNH BÁO RỦI RO** kèm mã 6 ký tự; agent không thấy cảnh báo này.
3. Gõ `/verid confirm <mã>` → agent nhận ngữ cảnh "đã cho phép 1 lần".
4. Nhờ agent ghi lại đúng nội dung đó → được. Ghi lần nữa → bị chặn.
5. `audit.jsonl` có `override_warned`, `override_created`, `override_used`. File này không chứa mã xác nhận.

## 4. Lỗi phải fail-closed

| Làm gì | Kết quả |
|---|---|
| Xoá `state.json` | Mọi tool call bị chặn với `VERID_E_STATE_MISSING`, kèm hướng dẫn tạo lại |
| Ghi rác vào `state.json` | `VERID_E_STATE_CORRUPT` |
| Đổi `args` sang file không tồn tại | Tool bị chặn: `failed; blocking because onFailure is "block"` |
