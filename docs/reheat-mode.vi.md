# Mode reheat: viết lại một hệ cũ

[Về README](../README.vi.md)

Mode `reheat` dựng lại một hệ cũ thành các module của một plan. Hệ cũ **chỉ đọc** và là chuẩn của hành vi
đúng. Công việc chia theo unit (một màn hình, một job, một báo cáo), mỗi unit là một module. Một **adapter**,
tức một [plugin](plugins.vi.md) do developer cài, đọc định dạng cũ. Các gate quen thuộc giữ nguyên: spec,
order, test đỏ, taste, review. Đóng một unit có thêm một điều kiện: **bằng chứng parity** do developer ký.

## Thiết lập

```sh
verid cook --mode reheat --legacy legacy
```

`--legacy` là thư mục hệ cũ, tính từ gốc dự án. Trong terminal, cook sẽ hỏi nếu thiếu cờ này. Hệ mới nằm
ở `app/`, hoặc ở thư mục do `--target <thư mục>` chỉ định; thư mục này phải nằm trong dự án và tách
khỏi thư mục hệ cũ. Cook ghi:

```yaml
mode: "reheat"
repos:
  - path: "app"
    source_globs: ["**"]
    test_globs: ["**/test/**", "**/*.test.*"]
  - path: "legacy"
    role: "legacy"
    read_only: true
    source_globs: ["**"]
    test_globs: ["**/test/**", "**/*.test.*"]
```

Repo có `role: legacy` phải ghi `read_only: true`, và chỉ mode reheat nhận role này. Thư mục cũ và mới phải
tách biệt. Sau đó cài một adapter (`verid plugin add file:<thư mục>`); [bản mẫu](../examples/adapters/sample/README.md)
là bản ngắn nhất. Drive `no-brain` chạy được ở mode này; station song song thì không.

## Repo cũ không bao giờ bị ghi

`VERID_BURNT_LEGACY_READ_ONLY` chặn mọi agent ghi vào thư mục hệ cũ: Edit, Write, `apply_patch`, công cụ
file MCP, redirect của shell, `sed -i`, `rm`, và lệnh `git` làm thay đổi repo (`commit`, `add`, `checkout`,
`reset`, ...), kể cả `git -C legacy ...`, `cd legacy && ...` và thư mục làm việc nằm trong đó. Đọc, và các
lệnh Git chỉ xem (`status`, `diff`, `log`, `show`), vẫn được. `/verid tip` không mở được chặn này. `verid taste`
và architecture check bỏ qua repo cũ, vì chạy test có thể xóa hoặc tạo file.

Kiểm tra shell chỉ đọc văn bản, nên một script, biến hoặc alias có thể giấu việc ghi. Muốn chắc chắn, hãy cho
thư mục này một checkout chỉ đọc hoặc bản clone không có quyền push.

## Các bước

| Bước      | Lệnh                          | Việc xảy ra                                                                                 |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| Inventory | `verid reheat inventory`      | Adapter liệt kê unit. Mỗi unit mới thành một module nháp trong `.verid/plan.md` cùng hồ sơ. |
| Extract   | `verid reheat extract <unit>` | Adapter ghi tư liệu cũ của unit vào `spec/legacy/` trong hồ sơ. verid ghi nhận các file.    |
| Spec      | skill của adapter             | Agent viết spec và tài liệu của unit từ `spec/legacy/`, có trích dẫn.                       |
| Gate      | `verid reheat gate <unit>`    | Adapter chấm spec. Kết quả đạt chỉ có giá trị với đúng các file nó đã chấm.                 |
| Order     | `verid order <unit>`          | Bị từ chối (`VERID_BURNT_REHEAT_GATE`) cho tới khi gate đạt trên file hiện tại.             |
| Build     | chu kỳ quen thuộc             | Test đỏ, code, `verid taste`, review.                                                       |
| Parity    | `release/parity.md`           | Đầu vào, kết quả hệ cũ và kết quả hệ mới, điền bằng các ca thật.                            |
| Serve     | `verid serve <unit>`          | Hỏi developer ký bằng chứng parity, hoặc nhận `--parity-signed`.                            |

Các lệnh `verid reheat` không chỉ dành cho developer: adapter là code bạn đã duyệt, như test runner. Ký parity
thì có: shell của agent không chạy được `verid serve`, và board từ chối agent.

**Mã thoát của `reheat gate`:** 0 đạt và parity đã ký, 1 gate không đạt hoặc adapter lỗi, 3 đạt nhưng parity
chưa ký. Gate không đạt trên unit đã order, chưa serve sẽ hủy order đó, như khi tài liệu của nó đổi. Adapter
lỗi (thoát khác 0, in sai dạng, không trả lời trong 300 giây) không đổi trạng thái nào; đặt
`VERID_ADAPTER_TIMEOUT_MS` để đổi hạn.

Inventory giữ nguyên plan: unit đã có trong plan được để như đã viết, chạy lại chỉ thêm unit mới. Mỗi unit mới
có `Artifacts:` và các tài liệu hồ sơ giữ chỗ, nên plan vẫn đọc được trong lúc phần còn lại chờ.

## Parity

`release/parity.md` cần ba mục có nội dung: `## Inputs`, `## Legacy results` và `## New results`. Còn dấu
`[NEEDS CLARIFICATION` thì mục đó coi như trống. Chữ ký là sha256 của file: sửa file là mất hiệu lực; spec
của unit hoặc `spec/legacy/` đổi thì gate mất hiệu lực.

- **big-brain:** `verid serve <unit>` hỏi `Ký bằng chứng parity?` trong terminal. Câu trả lời gắn với đúng bản
  bạn được xem. Trong script, thêm `--parity-signed`. Nút Serve trên board chỉ hiện sau khi unit đã ký.
- **no-brain:** drive không mở unit mà gate chưa đạt, và không serve unit chưa có chữ ký. Ký trên board (nút
  **Ký parity** trên thẻ của unit) hoặc chạy `verid serve <unit> --parity-signed` trong terminal; drive sau đó
  tự serve unit.

`verid menu` và board hiện trạng thái extract, gate và parity của từng unit, cùng nhóm và unit cha.

## Hợp đồng adapter

Adapter là plugin có khối `adapter` trong `verid-plugin.json`, cạnh các trường thường lệ:

```json
{
  "adapter": {
    "unitKind": "screen",
    "commands": {
      "inventory": "node adapter.mjs inventory \"{legacyRoot}\"",
      "extract": "node adapter.mjs extract \"{legacyRoot}\" {unit} \"{unitDir}\"",
      "gate": "node adapter.mjs gate \"{legacyRoot}\" {unit} \"{specPath}\""
    },
    "skill": "spec"
  }
}
```

Lệnh chạy trong thư mục plugin với môi trường của plugin, không qua shell, tối đa 300 giây. Dấu nháy gom đối
số, sau đó `{legacyRoot}`, `{unit}`, `{unitDir}` (hồ sơ của unit) và `{specPath}` (`spec/spec.md` trong đó)
được điền, nên đường dẫn có khoảng trắng vẫn là một đối số. `skill` là tên, không kèm tiền tố `<plugin>-`, của
một skill trong gói dùng để viết spec của unit. Mỗi lệnh in một tài liệu JSON ra stdout, tối đa 64 KiB:

| Lệnh        | In ra                                                             | verid kiểm                                                  |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `inventory` | `{"units": [{"id", "title", "parent"?, "family"?}]}`              | id kebab-case, không lặp, tối đa 2000                       |
| `extract`   | `{"unit", "files": ["screen.json"]}`                              | mỗi file có dưới `spec/legacy/` của unit, không là liên kết |
| `gate`      | `{"unit", "pass", "findings": [{"severity", "rule", "message"}]}` | đúng unit được hỏi                                          |

`extract` tự ghi file, dưới `{unitDir}/spec/legacy/`, và nêu tên mọi file đó tương đối với thư mục này: file
nằm lại mà nó không nêu tên sẽ làm gate từ chối cho tới khi chạy lại `extract`. Chỉ một plugin đang
bật được khai báo adapter. Adapter là code tin cậy, không phải sandbox.

## Lỗi

| Mã                             | Khi nào                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `VERID_BURNT_LEGACY_READ_ONLY` | Ghi vào repo cũ. Không override được.                          |
| `VERID_BURNT_ADAPTER`          | Không có adapter, lệnh lỗi, quá hạn, hoặc tài liệu sai dạng.   |
| `VERID_BURNT_REHEAT_GATE`      | `order` hoặc `serve` unit mà gate chưa đạt trên file hiện tại. |
| `VERID_BURNT_PARITY`           | `serve` unit mà bằng chứng parity chưa đủ hoặc chưa ký.        |

`verid doctor` báo repo cũ thiếu `read_only: true` và dự án reheat chưa có adapter.
