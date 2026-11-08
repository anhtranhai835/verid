# Rà soát lượng context và token của Verid

Ngày đo: 2026-11-08. Phạm vi: source, 25 skills, 14 agents, native entries,
session hooks, status và review packet trong repo này.

## Kết luận

Có thể giảm đáng kể lượng văn bản AI phải đọc bằng cách nạp đúng phần cần dùng,
tránh đọc lại instruction và tách lịch sử review khỏi diff hiện tại. Nén source
TypeScript, giảm số dòng code hoặc xóa tài liệu khỏi ổ đĩa không tự làm giảm token.

Cần phân biệt hai yêu cầu:

- Output của CLI, TDD gates và hành vi sản phẩm có thể được giữ nguyên bằng test.
  Các giao diện context mới nên là tùy chọn; giữ tương thích với lệnh cũ.
- Đổi context của AI không bảo đảm câu trả lời giống nguyên văn. Mục tiêu cần kiểm
  chứng là cùng AC, chất lượng code, khả năng phát hiện lỗi và quy tắc an toàn.

Các số liệu và đề xuất bên dưới là baseline ngày 2026-11-08. Phần cập nhật ở cuối
ghi rõ những thay đổi đã triển khai sau đó; các đề xuất còn lại chưa được áp dụng.

## Số liệu hiện tại

Kích thước file dưới đây đã chuẩn hóa CRLF thành LF. Đây là **ký tự, không phải
token**. Repo chưa thu thập `input_tokens`, `output_tokens` hay cached-input usage
của provider. Không có cơ sở khẳng định một tỷ lệ giảm chi phí tổng thể.

| Thành phần                 |          Ký tự | Ý nghĩa                                               |
| -------------------------- | -------------: | ----------------------------------------------------- |
| Tổng 25 `SKILL.md`         |         58.900 | Không phải tất cả đều được nạp mỗi phiên              |
| `edge-cases/SKILL.md`      |          9.512 | Entry gồm cả hướng dẫn và output của chế độ iterative |
| `debugging/SKILL.md`       |          9.428 | Bản upstream được kiểm tra checksum                   |
| `security/SKILL.md`        |          5.382 | Method, trust rules và verdict contract cần được giữ  |
| `tdd/SKILL.md`             |          3.294 | Có thể bị đọc lại ở nhiều writer/context              |
| UI `claudekit-original.md` |         44.295 | Wrapper hiện yêu cầu đọc file này để lấy topic index  |
| React `AGENTS.md` tổng hợp |         60.499 | Chỉ tốn context nếu được mở; đã có từng rule riêng    |
| Review history             | Tối đa 400.000 | Giới hạn output, không phải kích thước mọi lần review |

Các mẫu instruction được render trực tiếp từ code, workflow classic:

| Provider       | Resources installed | Resources repo |
| -------------- | ------------------: | -------------: |
| Claude         |               2.544 |          2.906 |
| Codex          |               3.227 |          3.420 |
| Claude + Codex |               4.214 |          4.332 |

Đây là block `AGENTS.md`; Claude thêm block import 50 ký tự. Tên/path khác nhau
có thể đổi kích thước. Danh mục 25 local skills dựng theo name, description và path
vào khoảng 3.909 ký tự, chưa tính định dạng riêng của host.

Mẫu Codex prep mới, tiếng Anh: startup/compact 678 ký tự, resume 121 ký tự.
Session context hiện đã có test giới hạn kích thước, kể cả plan 200 modules.
Đây không phải điểm cần cắt mạnh đầu tiên.

## Ưu tiên tối ưu

### 1. Tránh đọc lại instruction đã có trong context

`src/adapters/repo-resources.ts` tạo mọi native entry với yêu cầu đọc `AGENTS.md`
và `.verid/workflow.md` trước khi bắt đầu. Khi gọi nhiều skills/agents, agent có thể
đọc lại các file đó dù host đã đưa project instructions vào context.

Đề xuất: phân biệt rõ lần đầu trong một context và các lần gọi tiếp theo. Mỗi fresh
agent vẫn nhận đủ quy tắc; trong cùng context chỉ đọc lại khi file đổi hoặc phần đó
đã mất sau compaction. Không dùng cache giữa các module để bỏ qua thay đổi đầu vào.

Đo số lần Read trùng và lượng text trùng trước/sau. Giảm Read trùng không đồng
nghĩa toàn bộ token của lịch sử đã biến mất: context cũ vẫn có thể được gửi lại.

### 2. Thêm index ngắn cho các skill lớn, giữ nguyên tài liệu đầy đủ

- UI: thay bước đọc toàn bộ original bằng index khoảng 2.000 ký tự, rồi đọc đúng
  section hoặc chạy script search trên data liên quan. So với original, riêng bước
  mở đầu có dư địa giảm khoảng 95%; phần reference đọc tiếp phải được tính thêm.
- Edge cases: chuyển phần iterative, saturation và report dài sang reference chỉ
  nạp khi dùng chế độ đó. Giữ trigger, scope AC, severity và format one-shot trong
  entry. Mục tiêu entry khoảng 2.000 ký tự, giảm khoảng 79% riêng entry.
- Debugging: có thể dùng entry ngắn và giữ nguyên bản upstream làm reference.
  Không sửa thẳng bản được pin checksum rồi gọi đó là tối ưu an toàn; phải giữ
  provenance và cập nhật test phân phối. Các bước truy nguyên, test hồi quy và điều
  kiện dừng vẫn cần được truyền đầy đủ cho agent.
- React: ưu tiên các file `rules/<tên>.md`; không tự đọc bản tổng hợp 60.499 ký tự
  chỉ để trả lời một vấn đề rendering hoặc fetching.

Không xóa bản gốc hoặc bỏ phương pháp review/security để đạt chỉ tiêu kích thước.

### 3. Dùng status ngắn trong vòng TDD, menu khi cần toàn cảnh

Mẫu plan mô phỏng, cùng cấu hình tiếng Anh và cùng môi trường Git:

| Modules | `peek` | `menu` |
| ------- | -----: | -----: |
| 1       |    363 |    333 |
| 20      |    363 |    897 |
| 200     |    363 |  6.399 |

Ở mẫu 200 modules, `peek` ít hơn khoảng 94% ký tự so với `menu`. Không có lợi ích
đó ở mọi project: mẫu một module còn có menu ngắn hơn peek.

Agent nên gọi `menu` khi lập kế hoạch/chọn việc hoặc cần audit toàn cảnh, dùng
`peek` cho vòng lặp đang làm. Có thể thêm chế độ machine-readable ngắn; mặc định
lệnh cũ không cần đổi.

### 4. Tạo context packet theo module/AC

Hiện agent được giao tên AC và đường dẫn rồi tự tìm trong plan/design. Với tài liệu
lớn, việc mở cả file ở mỗi AC tạo nhiều context thừa.

Đề xuất một lệnh đọc, ví dụ `verid context --module <name> --ac <id>`, trả module
đang mở, AC, dependency, interfaces liên quan, runner và các path cần đọc. Canonical
docs và nội dung đầy đủ vẫn giữ nguyên. Packet phải dẫn nguồn, có hash và báo thiếu
dữ liệu; không thay bằng summary cũ rồi coi đó là yêu cầu đã được duyệt.

### 5. Tách review packet thành tổng quan, diff cuối và lịch sử

`workLog()` hiện xuất diff của từng commit từ base, rồi diff chưa commit. Một file
được sửa nhiều lần có thể xuất hiện nhiều lần trước khi reviewer đọc source nữa.

Đề xuất tùy chọn compact: summary/path/stat + diff cuối từ base đến working tree;
giữ lịch sử từng commit trong artifact riêng để reviewer mở khi cần. Giữ cả thay
đổi staged, unstaged, rename, delete và danh sách file mới; loại secret như hiện tại.
Review phải báo thiếu bằng chứng khi output bị cắt. Không chỉ giảm `LOG_LIMIT` rồi
âm thầm bỏ nội dung.

Mức tiết kiệm phụ thuộc số commit và mức sửa lặp; giới hạn 400.000 ký tự không có
nghĩa mọi review đang dùng hết số đó.

### 6. Kiểm soát chi phí dispatch và output trung gian

Claude build hướng dẫn giao tester/coder theo từng AC. Nếu 10 AC dùng 20 writer
contexts mới và mỗi writer đọc TDD một lần, riêng các lượt đọc TDD là 65.880 ký tự,
chưa gồm agent definitions, source và output tools.

Có thể thử hai writer contexts theo module, vẫn tách tester/coder và chạy tuần tự.
Phải đo tổng usage vì reuse giữ cả lịch sử cũ, có thể đắt hơn ở module dài. Không
thể coi việc giảm 20 lần đọc xuống hai lần đọc là giảm 90% tổng token. Reviewer
độc lập vẫn cần context mới; Codex hiện đã dùng main làm writer.

Scenario/report dài có thể giữ đầy đủ trong artifact, còn handoff chỉ gồm AC,
paths, trạng thái evidence, findings và bước tiếp theo. Người dùng vẫn có output
đầy đủ để mở. Không giấu lỗi test hay thiếu coverage để làm report trông ngắn.

## Phần đã làm tốt, nên giữ

- Session startup không in toàn bộ menu; resume ngắn hơn startup.
- `menu --commits --file` chỉ đưa path vào context của dispatcher.
- Test output đã giới hạn 10 failures, sáu dòng message và 20 dòng log tail.
- Nhiều domain skills đã dùng wrapper nhỏ và references riêng.
- Build đã yêu cầu đọc TDD một lần trong loop và chỉ giao identifiers/paths.
- TDD evidence, approval và reviewer được kiểm tra bằng hook, không chỉ bằng prose.

## Cách chứng minh không giảm chất lượng

1. Chọn task mẫu trước khi tối ưu: API, lỗi regression, UI, security, workspace và
   module nhiều AC. Dùng cùng source và yêu cầu cho baseline/optimized.
2. Giữ nguyên toàn bộ tests chức năng, fail-closed cases, role protections, evidence
   và review freshness. So sánh output CLI cũ khi không bật tùy chọn mới.
3. Với AI, so AC đạt, lỗi review bỏ sót, số vòng sửa và mức can thiệp của người dùng;
   không dùng độ giống nguyên văn làm thước đo chất lượng.
4. Thu metadata theo phase: input/output tokens khi provider cung cấp, cached input,
   ký tự tool output, số file đọc lại, số subagents, compactions và retries. Không
   lưu secret hoặc raw transcript vào telemetry.
5. Báo riêng giảm context, giảm output, giảm giá nhờ cache và giảm thời gian chạy.
   Cache có thể giảm giá/thời gian nhưng không phải cơ chế xóa context.

Nên bắt đầu với index của UI/edge-cases, đọc instruction một lần trong mỗi context,
và status/module packet ngắn. Sau đó mới thử thay đổi cách dispatch writer và cách
chia review packet. Chưa có benchmark usage để cam kết mức giảm token tổng thể.

## Cập nhật triển khai 2026-11-09

- Thêm `plugin/templates/skill-routing.md`: mỗi skill trong 25 skills và mỗi agent
  trong 14 agents đều có tình huống kích hoạt và đường trở lại flow chính. Generated
  instructions dẫn tới index này cho cả classic/modular/kanban, cả hai providers và
  hai chế độ resources. Tìm trigger/heading rồi chỉ nạp nhánh liên quan; dùng lại
  phần routing còn trong context, chỉ mở toàn bộ index khi chưa rõ nhánh cần chọn.
- Khi user báo lỗi, vào debugging trước; khi điều tra bế tắc hoặc các cách thử liên tục
  thất bại, dùng một kỹ thuật problem-solving. Helper chỉ phục vụ một câu hỏi cụ thể;
  Codex main xử lý vai trò chưa cấu hình. Không gọi toàn bộ catalog để tiết kiệm token.
- Native entries cho phép dùng lại instructions đang có trong context. Vẫn đọc lại khi
  thay đổi hoặc mất context, và vẫn nạp đủ quy tắc cho agent mới. Rút gọn cách diễn đạt
  của generated instructions, giữ quy tắc feedback, vai trò và gates.
- Context-engineering có guide đọc tài liệu và handoff riêng; không còn yêu cầu mở
  original để tìm topic. BA ghi coverage và version/hash nguồn; design và agents dùng
  source map rồi mở đúng section, mở rộng khi kiểm tra phụ thuộc và ngoại lệ.
- `document_reader.py` trích DOCX/PDF/Markdown/TXT cục bộ, trả outline/search/đoạn đọc
  theo block ID, SHA-256 và locator. Mặc định tối đa 6.000 ký tự **nội dung excerpt**,
  chưa tính JSON metadata. Có phân trang, offset và báo phần cắt rõ ràng; không ghi
  file, không có persistent cache, không tự cài dependency. PDF dùng pypdf nếu có;
  trang không có chữ, lỗi trích xuất và nội dung DOCX chưa xử lý đều cần theo dõi.
- UI dùng script tìm dữ liệu theo câu hỏi; React mở nhóm rule phù hợp. Bản original
  UI có 44.293 Unicode code points sau chuẩn hóa LF, nay là background tùy nhu cầu.
  Bốn lệnh tìm UI mẫu trả 1.129–1.508 ký tự JSON mỗi lệnh; vẫn phải cộng wrapper,
  routing, nguồn được mở thêm và lịch sử context khi đánh giá chi phí cả task.
- Chín wrapper domain còn lại tìm tên file/heading phù hợp trước; original là index
  mở khi cần, thay cho bước đọc toàn bộ bắt buộc. Giữ nguyên các bản tham khảo, license,
  hướng dẫn chuyên biệt và TDD/permission rules.

Đã thêm kiểm tra graph phân phối để phát hiện skill/agent thiếu route hoặc link hỏng,
và kiểm thử reader bằng DOCX, PDF thật được tạo với dữ liệu tổng hợp, Unicode, bảng,
phần đọc tiếp và nguồn thay đổi. Không thay TDD gates, review freshness hay cơ chế
phân quyền. Chưa có provider usage để công bố phần trăm tiết kiệm token hay chi phí.

Với resources repo, cook vẫn giữ nguyên các bản skill/agent/workflow đã tùy chỉnh.
File mới được bổ sung, nhưng nội dung cũ cần được đồng bộ có chọn lọc để dùng đầy đủ
flow mới; không có migration ghi đè tùy chỉnh tự động.
