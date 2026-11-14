# Thay đổi nhỏ

Ở `prep` và `recipe` mọi thay đổi đều đi qua một module (`order`, build, review, `serve`),
nhưng hồ sơ module có thể ngắn. Chọn theo cỡ việc; gate như nhau trên mọi đường.

| Đường  | Khi nào                       | Developer chạy               | Hồ sơ                                                                                      |
| ------ | ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| đầy đủ | Tính năng, hoặc nhiều AC      | `verid module <tên>`         | Mọi tài liệu đầu vào lấy từ `.verid/templates/module/`                                     |
| quick  | Một thay đổi nhỏ, đúng một AC | `verid module <tên> --quick` | Thay đổi và yêu cầu của nó; các tài liệu khác là một dòng `Not applicable`                 |
| fix    | Sửa bug                       | `verid module <tên> --fix`   | Triệu chứng, cách tái hiện, nguyên nhân gốc (tìm bằng skill debugging trước khi viết code) |

`verid order` từ chối module quick hoặc fix có hơn một AC, và module fix có mục `## Root cause`
trống; lời từ chối nêu lệnh chuyển sang module đầy đủ. AC duy nhất của fix là một test tái hiện
bug: đỏ trước khi sửa, xanh sau khi sửa. Test khẳng định: `unified-flow.e2e`, "the quick path
keeps every gate…" và "the fix path keeps every gate…".

Bảng dưới là điều hook ép ở từng mode và drive; mỗi hàng nêu test khẳng định nó.

| Mode và drive              | Tình huống          | Developer chạy                                             | Agent được làm                                                                                      | Test khẳng định                                                                                                                                              |
| -------------------------- | ------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `remix`                    | Sửa một dòng        | Không cần                                                  | Viết test đỏ, sửa, chạy `verid taste`. Không cần module.                                            | `tdd.e2e`: "RAW: denies production code, allows tests and other files", "runs the whole loop together with verid taste"                                      |
| `remix`                    | Chỉ refactor        | `verid garnish` sau lần chạy xanh                          | Sửa code production khi ở PLATED.                                                                   | `tdd.e2e`: "lets only the developer declare a refactoring session, and only on a passing run"                                                                |
| `remix`                    | Một lần ghi bị chặn | `/verid tip <lý do>`, rồi `/verid confirm <mã>`            | Đúng lần ghi đó, một lần.                                                                           | `tdd.e2e`: "lets the developer override the gate once, for that exact write"                                                                                 |
| `prep`/`recipe`, big-brain | Chưa chọn task      | `verid board`, rồi `verid order <module>`, rồi session mới | Không gì cả: code và test bị chặn (`VERID_BURNT_TASK_SESSION`), `/verid tip` không mở được.         | `rules-audit.e2e`: "keeps state, Git internals, MCP configuration and unapproved code protected"; `tdd.e2e`: "will not let /verid tip lift the task session" |
| `prep`/`recipe`, big-brain | Đã order module     | Không thêm                                                 | Chu trình thường: test đỏ trước, rồi code. File nào cũng sửa được; chu trình không gắn file với AC. | `tdd.e2e`: "approves one module of a plan with modules, and opens production code"                                                                           |
| `prep`/`recipe`, no-brain  | Bất cứ lúc nào      | Không gì cả                                                | Vòng thường: test hỏng trước, rồi code. verid tự ký research và design.                             | `auto.e2e`: "never locks a write for want of a module or a stuck drive: the TDD cycle alone judges it"                                                       |

Module đã serve thì code bị khóa lại. Muốn sửa phần đã serve, sửa mục của module đó trong
`.verid/plan.md` rồi order lại.
