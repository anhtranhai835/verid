# Module và board

## Luồng module và tài nguyên

`prep` và `recipe` luôn có hồ sơ module và board, cho cả monorepo (một Git repo) và workspace (nhiều repo con). Cook cho chọn layout, mặc định theo tự nhận diện. Workspace phải nằm ngoài repo Git và có ít nhất một repo con. Project đã có manifest giữ layout đã chọn.

| Cấu hình  | Giá trị     | Hành vi                                                                                            |
| --------- | ----------- | -------------------------------------------------------------------------------------------------- |
| Drive     | `big-brain` | Người dùng chọn task; mỗi task một session AI mới; người dùng serve.                               |
| Drive     | `no-brain`  | Chủ project chat trên board, đọc rồi ký research và design ngay ở đó; một session đi hết hàng đợi. |
| Resources | `installed` | Dùng skills và agents đã cài.                                                                      |
| Resources | `repo`      | Pin skills, agents, templates và runtime trong project; giữ tùy chỉnh đã có.                       |

`remix` giữ luồng baseline; board báo không có task.

### Board: chọn task và xếp ưu tiên

```sh
verid cook --mode prep --provider codex --yes
verid board
# Nếu dùng tài nguyên repo: node .verid/verid.mjs board
```

Lệnh mở board trên trình duyệt; giữ terminal đó chạy. Dùng `--no-open` để tự mở
URL được in ra, hoặc `--port 4318` để chọn cổng.

1. Viết yêu cầu trong `.verid/spec.md` dạng `- REQ-1: hành vi kiểm thử được`
   (cũng hỗ trợ `NFR-1`, `SEC-1`). Board hiện spec/plan ở chế độ chỉ đọc; sửa trong editor hoặc nhờ agent.
   Hoàn thiện research và design trước khi chọn task.
2. Nhấn **Tách task từ spec** để tạo bản nháp một task cho mỗi yêu cầu và task
   kiểm thử sản phẩm cuối cùng. Giữ nguyên plan đã tồn tại. Chỉnh scope, tiêu chí
   và phụ thuộc trong `.verid/plan.md`, hoặc để AI lập plan chi tiết.
   Mỗi `## Module: <tên>` là một card; `Title:` đặt tên dễ đọc.
3. Với drive big-brain, chọn task muốn làm trước. Verid duyệt bằng `order`, chỉ mở một task mỗi lần.
   Sao chép nội dung session của task sang session AI mới trong terminal/IDE.
   Drive big-brain không có chat trên board.
4. AI làm TDD và review độc lập. Nhấn **Duyệt & lên món** để chạy `serve` với
   đầy đủ kiểm tra bằng chứng. Dừng session cũ, chọn task tiếp theo rồi mở session mới.

Hook lưu ràng buộc task/session qua các lần chạy. Session lập kế hoạch, session
khác đang mở và session từng làm task trước không được nhận task này. Resume/compact
giữ task hiện tại; clear context không cho session cũ nhận task tiếp theo. Sửa spec,
scope trong plan hoặc design phải duyệt lại và mở session mới. AI không tự chọn task kế tiếp.

Dùng ↑/↓ hoặc Alt+↑/↓ trên card để xếp task chưa bắt đầu. Thứ tự lưu cục bộ qua lần khởi động lại; `verid menu` dùng cùng thứ tự. Task đang làm được giữ nguyên, `product` luôn cuối. Drive big-brain đánh dấu task tiếp theo nhưng vẫn cho chọn task khác. Drive no-brain ẩn nút chọn task. Board của nó có khung chat với session AI duy nhất của drive (CLI của provider chạy headless: `claude -p`, `codex exec`, `agy -p`) và nút **Ký research & design**. Trước nút ký, board hiện `.verid/summary.md` (trang tóm tắt lời thường của agent, nếu có), `research.md` và `design.md`. Ký ở đây ghi đúng chữ ký như `verid order` trong terminal và bị từ chối khi thiếu một trong hai file. Phụ thuộc vẫn là cảnh báo.

Board no-brain vẽ lượt chạy như một nhà hàng: nhân vật pixel art bếp trưởng (research và plan), bếp phó (design), người nếm (test hỏng, `verid taste`), phụ bếp (code tới khi xanh), thanh tra (review và bảo mật) và bồi bàn; bạn là khách. Vai đang làm thì động, còn lại đứng chờ (đứng yên hết khi bật giảm chuyển động). Mỗi task nằm trên quầy ra món theo trạng thái thật: phiếu chờ, RAW, COOKING, PLATED hay đã lên bàn. Khi lượt chạy cần bạn (dừng, kẹt vì câu hỏi hoặc review hỏng lặp lại, hook vừa chặn trong 15 phút, tài liệu chờ ký, xong hết) bồi bàn nói lý do bằng lời thường và gợi ý một bước tiếp; trả lời trong ô chat. Lời dựng từ trạng thái và mã từ chối; không gọi model.

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

[Hướng dẫn modular cook](modular-cook.md) có đầy đủ template và luồng thực hiện.

Với thay đổi nhỏ, xem [thay đổi nhỏ](small-changes.vi.md).

## TDD và bằng chứng

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
