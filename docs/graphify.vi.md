# Graphify cho verid

Project dùng Graphify để tra cứu quan hệ giữa các file và symbol trong mã nguồn.
Đã cấu hình skill và hướng dẫn cho Codex (`AGENTS.md`, `.agents/skills/graphify/`,
kèm bản tại `.codex/skills/graphify/` theo trình cài Graphify)
và Claude Code (`CLAUDE.md`, `.claude/skills/graphify/`).

## Chạy trong terminal

Mở terminal tại thư mục `verid`, nơi có `package.json`:

```powershell
npm run graphify:build
npm run graphify:query -- "cook"
graphify explain "src/cli/entry.ts"
graphify affected "src/cli/entry.ts"
npm run graphify:watch
```

`graphify:build` trích xuất mã nguồn bằng AST, sau đó phân cụm và tạo báo cáo cùng
trang HTML. Lệnh này chạy cục bộ, không gọi LLM và không cần API key. Chạy lại lệnh
sau khi thay đổi code để cập nhật graph, hoặc dùng `graphify:watch` trong khi làm việc.

Kết quả nằm trong `graphify-out/`:

- `graph.json`: dữ liệu để query, explain và affected.
- `GRAPH_REPORT.md`: tổng quan kiến trúc.
- `graph.html`: bản đồ tương tác, mở bằng trình duyệt.

`.graphifyignore` loại dependency, build output, skill đã cài và file môi trường.
`graphify-out/` được bỏ qua trong Git vì có thể tạo lại bằng lệnh build.

## Dùng trong trợ lý

Mở lại project trong Codex hoặc Claude Code để nhận skill mới, rồi dùng `/graphify`
hoặc đặt câu hỏi về mã nguồn. Khi graph đã có, hướng dẫn project yêu cầu trợ lý
query graph trước khi đọc code và cập nhật graph sau khi sửa code.

Phần thiết lập ban đầu chỉ lập bản đồ code. Phân tích ngữ nghĩa tài liệu/PDF/ảnh
cần model của trợ lý hoặc backend LLM được cấu hình riêng.

## Cài trên máy khác

Cần Python 3.10+ và Graphify trong PATH. Phiên bản dùng lúc cấu hình: `0.9.100`.

```powershell
uv tool install graphifyy==0.9.100
npm run graphify:build
```

Tài liệu chính thức: https://github.com/Graphify-Labs/graphify
