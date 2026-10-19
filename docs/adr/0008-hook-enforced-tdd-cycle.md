# ADR-0008: Vòng TDD do hook ép, bằng chứng lấy từ `verid test`

- Trạng thái: Accepted, 2026-10-19

## Bối cảnh
Phase 0 mới bảo vệ file. Phần cốt lõi của verid là TDD có bằng chứng. Quy trình mẫu là skill `superpowers:test-driven-development`: "NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST", phải xem test fail rồi mới viết code, "Fix code, not test", và test pass ngay từ đầu là dấu hiệu đỏ. Skill chỉ là lời dặn: agent vẫn có thể viết code trước, hoặc sửa test cho dễ pass. Ngày 2026-10-19, developer chọn mức ép "chặt như superpowers".

## Quyết định
- `verid test` chạy `test_cmd` của manifest. verid đọc báo cáo JUnit mà lệnh ghi ra `{junit}`, và chỉ tính lần chạy là bằng chứng khi mã thoát khớp với báo cáo: có test fail khi và chỉ khi mã thoát khác 0, và có ít nhất một test thực sự chạy. `<error>` được tính như fail. Với pytest, thiếu module cần test là lỗi collection; vì code production đang bị khoá ở RED, nếu không tính `<error>` là fail thì không còn đường ra.
- Trạng thái nằm trong `state.json` (`tdd.state`, `tdd.last_run`). Project mới bắt đầu ở RED.

| Trạng thái | Ghi code production | Ghi test | `verid test` fail | `verid test` pass |
|---|---|---|---|---|
| RED | chặn (`VERID_E_TDD_NO_FAILING_TEST`) | được | → GREEN | giữ RED |
| GREEN | được | được, về RED | giữ GREEN | → REFACTOR |
| REFACTOR | được | được, về RED | → GREEN | giữ REFACTOR |

- Sửa test sau khi đã xem nó fail sẽ đưa vòng về RED. Đây là bước "verify RED → wrong failure → RED" trong sơ đồ của superpowers: test đã đổi thì phải xem nó fail lại. Nếu test bị nới cho dễ pass thì nó pass ngay, vòng ở lại RED và code production vẫn bị khoá.
- Hook phân loại đường dẫn theo `source_globs` và `test_globs` của manifest. File khớp cả hai glob được coi là test. File không khớp glob nào (docs, config) thì không bị chặn.
- `VERID_E_TDD_NO_FAILING_TEST` override được bằng `/verid allow` ([ADR-0007](0007-two-step-override-attended-session.md)).
- Không có manifest thì không có cổng TDD, giữ đúng hành vi của Phase 0.
- Mỗi lần chạy được lưu ở `.state/runs/<id>/` gồm `junit.xml`, `output.log` và `run.json`. Audit ghi `test_run` (kèm sha256 của `junit.xml`) và `tdd_reopened`.
- CLI chỉ in tên các test fail kèm thông điệp lỗi, và toàn bộ output nằm trong `output.log`. Cách này học từ `executing-plans` của superpowers: giữ output đầy đủ trong file, chỉ in phần agent cần đọc, vì mọi dòng in ra đều bị đọc lại ở các lượt sau.

## Lựa chọn thay thế
- Chỉ chặn ở RED: đơn giản hơn, nhưng agent có thể sửa test cho dễ pass trong GREEN mà verid không biết.
- Chỉ ghi bằng chứng, không chặn: ít ma sát nhất, nhưng không ép được TDD.
- Khoá file test trong GREEN: cứng hơn. Nhưng nếu test fail sai lý do (gõ nhầm) thì agent bị kẹt, và developer phải override cho từng lần ghi.
- Để agent tự báo kết quả test: lời tự báo không phải bằng chứng.
- Dùng LLM để chấm xem code có vượt quá phạm vi test hay không: chậm, tốn tiền, và kết quả không tất định.

## Hệ quả
- Project có manifest bắt đầu ở RED: viết code production trước khi có test là bị chặn ngay.
- Hook ghi state cả trong lúc cho qua (khi đưa vòng về RED), và lấy lock giống như lúc chặn.
- Hook đọc manifest ở mỗi lần ghi file. Để không phải nạp `yaml` ở mỗi lần (khoảng 15 ms trên Linux), manifest đã validate được cache trong `.state/manifest.cache.json`, theo sha256 của file. `yaml` nằm ở một chunk riêng và chỉ được nạp khi cache trượt. Số đo trên Linux (median): Read 80 → 83 ms, Write 79 → 84 ms, Write khi cache trượt 105 ms. Cần đo lại trên Windows.
- Giới hạn: verid không biết code viết trong GREEN/REFACTOR có vượt quá những gì test đòi hỏi hay không. Ghi file bằng Bash lách được cổng (Phase 4). Code test do agent viết chạy với toàn quyền, nên có thể ghi đè `junit.xml`.
