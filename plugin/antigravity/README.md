# Verid Antigravity Plugin (`plugin/antigravity`)

Bộ tích hợp **Verid TDD Harness (`RAW -> COOKING -> PLATED`)** dành riêng cho **Google Antigravity**, được thiết kế để **không cần sửa source code TypeScript của `verid`** mà vẫn cưỡng chế đầy đủ TDD/Policy hooks và **tối ưu hóa tối đa lượng token tiêu thụ**.

---

## Cấu trúc thư mục

```text
plugin/antigravity/
├── plugin.json                  # Manifest chuẩn của Antigravity Plugin
├── hooks.json                   # Đăng ký lifecycle hooks (SessionStart, PreInvocation, PreToolUse, PostToolUse, Stop)
├── assets/
│   └── logo.svg                 # Biểu tượng hiển thị trong trang Customizations
├── hooks/
│   └── antigravity-hook.mjs     # Bridge chuyển đổi giao thức camelCase của Antigravity <-> verid dist/hook.js
├── rules/
│   └── AGENTS.md                # Rule siêu gọn (~1.100 ký tự), tự động kích hoạt khi project có .verid/
├── agents/
│   ├── verid-reviewer.md        # Subagent review độc lập (tools: [read_file])
│   ├── verid-security.md        # Subagent security độc lập (tools: [read_file])
│   └── verid-debugger.md        # Subagent điều tra lỗi cô lập (tools: [read_file])
├── skills/
│   ├── verid-onboard/SKILL.md   # Kiểm tra sức khỏe & trạng thái project
│   ├── verid-ba/SKILL.md        # Research & EARS spec (.verid/spec.md)
│   ├── verid-design/SKILL.md    # Kiến trúc & .verid/design.md
│   ├── verid-plan/SKILL.md      # Lập kế hoạch module & AC (.verid/plan.md)
│   ├── verid-build/SKILL.md     # Vòng lặp Single-Writer TDD (RAW -> COOKING -> PLATED)
│   ├── verid-debugging/SKILL.md # Điều tra nguyên nhân gốc trước khi sửa lỗi
│   ├── verid-review/SKILL.md    # Tạo snapshot & gọi subagent review độc lập
│   └── verid-router/SKILL.md    # Router 1-hop tới 17 bộ tài liệu chuyên ngành (UI, React, DB, DevOps...)
├── presets/
│   ├── manifest.lite.yaml       # Chế độ Lite (mode: remix) — Giữ khóa TDD cứng, bỏ lễ nghi spec/plan/review
│   ├── manifest.standard.yaml   # Chế độ Standard — Single-writer TDD + 1 subagent verid-reviewer
│   └── manifest.strict.yaml     # Chế độ Strict — Đầy đủ EARS spec + verid-reviewer + verid-security
└── workspace-template/
    └── .agents/                 # Mẫu cấu hình .agents/skills.json (tắt trùng lặp superpowers) & plugins.json
```

---

## Cài đặt Global Plugin trên máy

Plugin đã được cài sẵn tại `~/.gemini/config/plugins/verid/`.
Để cập nhật lại từ repo `aeriq` sau khi build (`npm run build`):

```powershell
$dest = "$HOME\.gemini\config\plugins\verid"
New-Item -ItemType Directory -Force -Path $dest, "$dest\runtime", "$dest\resources" | Out-Null
Copy-Item -Path "plugin\antigravity\*" -Destination $dest -Recurse -Force
Copy-Item -Path "dist\*" -Destination "$dest\runtime" -Recurse -Force
Copy-Item -Path "plugin\skills", "plugin\templates", "i18n" -Destination "$dest\resources" -Recurse -Force
```

---

## Cách sử dụng trong Project với Antigravity

1. **Khởi tạo project với `verid cook` (trong terminal của bạn):**
   - Khuyến nghị dùng `--provider codex` (hoặc `--provider claude-code` đều tương thích nhờ cơ chế Single-Writer Bridge):
     ```powershell
     verid cook --mode prep --workflow modular --resources repo --provider codex --yes
     ```
   - Lưu ý: nếu dùng `--resources repo`, xóa thư mục `.agents/skills/` chứa các file stub redirect (hoặc thay bằng `.agents/skills.json` trong `workspace-template/.agents/skills.json`) để Antigravity dùng trực tiếp bộ 8 progressive skills của plugin, tránh đọc nhảy 2 bước.
2. **Làm việc trên Antigravity:**
   - Mở project trong Antigravity. `SessionStart` tự động nạp trạng thái TDD (`RAW / COOKING / PLATED`) và bước tiếp theo.
   - Gõ `/verid peek` hoặc `/verid menu` ngay trong ô chat để xem trạng thái tức thì (**0 token gọi model**).
   - Khi cần mở ngoại lệ có kiểm soát: gõ `/verid tip <lý do>` rồi `/verid confirm <mã>` ngay trong ô chat.

