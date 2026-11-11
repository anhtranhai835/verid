# Station song song

Mỗi station là một worktree, nhánh `feat/<module>`, vòng TDD và session provider
riêng cho một module độc lập. Hỗ trợ Claude Code, Codex, Antigravity; chỉ dành cho
prep/recipe đặt tại gốc một Git repo với `repos.path: .`, chưa hỗ trợ workspace
nhiều repo.

Trước AC đầu tiên, khai báo file module sở hữu và phụ thuộc:

```markdown
## Module: identity

Artifacts: .verid/artifacts/03-modules/identity
Boundary: src/identity/**, test/identity/**
Depends: foundation

- AC-1: thông tin hợp lệ mở phiên thành viên (REQ-1)
```

Boundary dùng glob `*`, `**`, `?` hiện có, tương đối từ gốc project; không dùng
đường tuyệt đối, dấu `\` hay `..`. Khai báo cả file dùng chung nếu cần sửa.
Trường hợp glob có thể giao nhau bị từ chối theo tiền tố cố định; tách file dùng
chung thành module nền. Phụ thuộc phải serve và gộp xong trước khi mở station.

Commit setup, plan, hồ sơ và runtime ghim trước. Trong terminal của bạn:

```sh
verid order identity
verid station identity
verid order billing
verid station billing
verid station list
```

Mở session provider mới ở từng đường dẫn được in, thường là
`../<project>.stations/<module>`. Codex cần trust worktree và hook qua UI của
provider; Antigravity mở đúng worktree làm workspace. Chạy `verid doctor` trước
khi làm. Bản đầu chưa hỗ trợ main dispatch subagent sang worktree khác.

Station chỉ chép approval của đúng module; evidence, review và session bắt đầu
mới. `CLAUDE_PROJECT_DIR` kế thừa không kéo station đã đăng ký về state cây chính.
Cây chính không được ghi file thuộc station đang mở. Session không chuyển giữa
các station khi clear/compact. Dùng công cụ file để sửa; shell chỉ cho phép lệnh
Git đọc/commit cục bộ đơn giản và `verid taste`, `peek`, `menu`, `context`, `usage`.
Giữ nguyên gate test đỏ, vai trò và review độc lập.

Hoàn thành TDD, serve trong station rồi commit toàn bộ công việc. Trở về nhánh
gốc sạch của cây chính:

```sh
verid station close identity
verid station close billing
```

Close kiểm approval và ranh giới file đã commit, gộp squash rồi chạy `taste` trên
cây đã gộp. Chỉ khi đạt mới ghi commit `integrated` và tính module xong ở cây
chính. Test hỏng hoặc conflict giữ station và module chưa xong; conflict in tên
file, không tự sửa. Merge thất bại được hoàn tác khi bắt đầu từ cây sạch; sửa
đồng thời hoặc ngắt giữa lúc gộp cần kiểm tra trong terminal. `doctor` báo stage
dở dang. Lỗi gỡ worktree giữ registry; thả khóa file Windows rồi chạy close lại.
Nhánh station được giữ để đối chiếu. Evidence cục bộ được lưu vào state riêng tư
của cây chính trước khi gỡ; sự kiện usage được giữ trong audit cây chính.

Tối đa ba station mở. No-brain: đặt `stations: 2` hoặc `3` trước khi ký
`verid order`; bỏ trống là `1`, giữ luồng tuần tự. Sau review plan độc lập, drive
mở các module đủ điều kiện theo hàng đợi. Bộ đếm lỗi riêng giúp một station bị
kẹt không chặn station khác. `product` chờ mọi station gộp xong và chạy ở cây
chính; close vẫn do developer chạy.

Board hiển thị TDD riêng trên thẻ Đang làm. Station đã serve vẫn ở đó tới khi gộp
đạt. Chat no-brain có bộ chọn Cuộc hội thoại cho project và từng station, lịch
sử/nút dừng riêng; tối đa `stations` tiến trình provider đồng thời. Khi cuộc hội
thoại điều phối kết thúc một lượt, board có thể mở session cho station đủ điều
kiện. Tắt board sẽ dừng các tiến trình con.

`doctor` báo worktree station mồ côi, nhánh/worktree bị mất và approval lệch.
Giữ registry/state riêng tư, ngoài Git. Nếu mở station bị ngắt, kiểm
`git worktree list`, chỉ gỡ worktree/nhánh mở lỗi trong terminal rồi sửa đúng
registry trước khi thử lại. Không xóa state station khác để đặt lại gate.

Session song song dùng thêm ngữ cảnh model. Chưa có số đo token/thời gian hoặc
walkthrough provider thật; mặc định vẫn tuần tự.

[English](stations.md)
