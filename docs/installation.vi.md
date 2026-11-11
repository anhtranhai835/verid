# Cài đặt và thiết lập

## Yêu cầu

- Node.js **22 trở lên**, có npm trong `PATH`.
- Git để thao tác repository và workspace.
- Claude Code, Codex CLI hoặc cả hai.

## Cài đặt

### Gói đã phát hành (cài global tùy chọn)

verid không có trên registry npm. Mỗi bản là một file `.tgz` đính trong GitHub Release của repo
không công khai `anhtranhai835/verid`, nên cần tài khoản GitHub có quyền đọc repo và
[GitHub CLI](https://cli.github.com) đã đăng nhập bằng `gh auth login`.

Các lệnh cài một dòng tải Release mới nhất (hoặc bản ghi trong `VERID_VERSION`, ví dụ `2.0.0`),
cài bằng npm và thử thiết lập provider. Máy cần có Node.js trước.

**Windows — PowerShell**

```powershell
gh api -H "Accept: application/vnd.github.raw" repos/anhtranhai835/verid/contents/install.ps1 | Out-String | iex
```

**macOS / Linux**

```sh
gh api -H "Accept: application/vnd.github.raw" repos/anhtranhai835/verid/contents/install.sh | sh
```

Không dùng installer: tải file `.tgz` ở trang Releases của repo, hoặc bằng
`gh release download --repo anhtranhai835/verid --pattern "*.tgz"`, rồi chạy
`npm install -g ./anhtranhai835-verid-X.Y.Z.tgz`.

Lệnh plugin của Claude Code `claude plugin marketplace add anhtranhai835/verid` và
`claude plugin install verid@verid` cũng cần quyền đọc repo.

Trong terminal tương tác, installer có thể hỏi thư mục project rồi chạy
`verid cook`. Với CI hoặc khi không có terminal, tự chạy cook sau khi cài.

### Source hiện tại, gồm luồng modular mới

Dùng bản build từ source nếu Release mới nhất chưa có tính năng mô tả trong README này:

```sh
git clone https://github.com/anhtranhai835/verid.git
cd verid
npm ci
npm run build
```

Từ project đích, chạy CLI đã build một lần, thay đường dẫn bằng checkout của bạn:

```sh
node /path/to/verid/dist/cli.js cook --mode prep --resources repo --provider codex --yes
```

Sau cook, repo có CLI và các thư viện runtime đi kèm. Từ gốc project:

```sh
node .verid/verid.mjs module identity
node .verid/verid.mjs menu
node .verid/verid.mjs taste
```

Chế độ repo chạy được mà không cần cài verid global hoặc một bộ `node_modules` riêng
cho verid. Máy vẫn cần Node.js, provider và test runner của project.
Tên lệnh khi cài global tùy chọn là `verid`; tên gói npm là `@anhtranhai835/verid`.

### Bắt đầu với hồ sơ modular và tài nguyên trong repo

```sh
verid cook --mode prep --resources repo --provider codex --yes
node .verid/verid.mjs module identity
```

Điền bản nháp của module, rồi tổng hợp yêu cầu, thiết kế và AC đã thống nhất vào
`.verid/spec.md`, `.verid/design.md` và `.verid/plan.md`. Cook chờ nội dung thật
của các tài liệu đầu vào này để xét approval.

Với Codex, trust project và hook đã tạo qua `/hooks` rồi chạy `verid doctor`.
Xem [thiết lập Codex](#thiết-lập-codex).

## Thiết lập Codex

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
Xem [ghi chú kiểm chứng](modular-cook.md#dùng-với-codex).

## Thiết lập Antigravity

1. Chạy `verid setup-antigravity` một lần trên mỗi máy, và chạy lại sau mỗi lần cập nhật
   verid. Lệnh cài plugin vào `~/.gemini/config/plugins/verid/`. Khởi động lại Antigravity.
2. Chạy cook với `--provider antigravity` (thêm `--provider claude-code` nếu dùng cả hai).
3. Chạy `verid doctor` và xử lý các phát hiện.
4. Để main viết test/code; gọi `verid-reviewer` (và `verid-security`) bằng
   `invoke_subagent` để review. Gõ `/verid peek`, `/verid tip`, `/verid confirm` trong chat.

Lõi verid tự đọc payload hook của Antigravity, nên cùng một bộ luật, cổng TDD và ràng buộc
review áp dụng như trên Claude Code và Codex. Định dạng payload chưa được đối chiếu với
fixture ghi lại từ Antigravity thật. Xem [ghi chú tích hợp](antigravity-integration.vi.md).

## Nâng cấp

Với tài nguyên repo, `node .verid/verid.mjs cook --yes` nối lại phiên bản đã commit
cho máy hiện tại. Khi đổi phiên bản được pin, xem diff và cập nhật runtime cùng các
bản tài nguyên trong repo. Nếu chọn cài global, có thể nâng cấp bằng:

```sh
gh release download --repo anhtranhai835/verid --pattern "*.tgz" --clobber
npm install -g ./anhtranhai835-verid-*.tgz
verid upgrade --dry-run
verid upgrade --yes
verid doctor
```

Nếu cài từ source, cập nhật checkout, build rồi cài lại trước.
Upgrade cập nhật wiring và chỉ dẫn provider, thêm defaults còn thiếu đã được chấp
nhận. Tài nguyên repo và hồ sơ module đã có được giữ lại. Để làm mới tài nguyên
được pin, xem diff rồi thay các bản cần cập nhật.

Drive nay tên là `big-brain` (trước là `human`) và `no-brain` (trước là `ai`). Manifest ghi tên
cũ `human`, `ai` hoặc `auto` vẫn nạp được, `--drive` vẫn nhận các tên đó; manifest mới được ghi
bằng tên mới. Không cần sửa gì.

## Nâng cấp từ 1.x

Đây là bản 2.0.0. Manifest cũ với `workflow: classic`, `workflow: modular`, `workflow: kanban` hoặc thiếu trường này vẫn nạp được; `--workflow` chỉ còn là flag tương thích.

Chạy `verid upgrade --dry-run` rồi `verid upgrade --yes`. Upgrade bỏ workflow cũ, thêm templates/cây artifacts, tạo hồ sơ nháp và dòng Artifacts cho module chưa serve. Điền hồ sơ rồi order lại; task đang mở cần session mới ở big-brain drive. Section, approval và bằng chứng module đã serve được giữ nguyên. Chạy `verid doctor` để xem phần còn thiếu.

Với resources repo, cập nhật runtime pin trong `.verid/hooks/` và tài nguyên cần thiết sau khi nâng gói; upgrade giữ tùy chỉnh đã có. Trước khi hạ về 1.x, bỏ trường `kanban.queue` trong state bằng terminal của người dùng.
