# Tham chiếu cook

## Flags của cook

```sh
verid cook --mode prep --resources repo --provider codex --lang vi --yes
```

| Flag                                         | Giá trị hoặc tác dụng                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `--mode`                                     | `prep`, `recipe`, `remix` hoặc `reheat`.                                                      |
| `--resources`                                | `installed` hoặc `repo`.                                                                      |
| `--provider`                                 | `claude-code`, `codex` hoặc `antigravity`; lặp flag để chọn nhiều.                            |
| `--drive`                                    | `big-brain` hoặc `no-brain` cho prep/recipe (`human`, `ai`, `auto` là tên cũ).                |
| `--architecture`                             | `ddd`, `clean`, `layered` hoặc `none`.                                                        |
| `--layout`                                   | `monorepo` hoặc `workspace`; bỏ trống để tự nhận diện.                                        |
| `--legacy`                                   | Cho `--mode reheat`: thư mục hệ cũ, luôn chỉ đọc.                                             |
| `--target`                                   | Cho `--mode reheat`: thư mục của hệ mới, trong dự án và tách khỏi `--legacy`; mặc định `app`. |
| `--lang`                                     | `en` hoặc `vi`; ngôn ngữ CLI trên máy này.                                                    |
| `--test-cmd`                                 | Lệnh riêng có `{junit}` hoặc `VERID_JUNIT`.                                                   |
| `--src` / `--tests`                          | Globs source và test; có thể lặp flag.                                                        |
| `--iterations`                               | Bật lịch iteration; đi kèm duration, ngày bắt đầu và ngày demo bên dưới.                      |
| `--duration` / `--start-date` / `--demo-day` | Ví dụ `"2 weeks"`, `2026-11-09`, `Sunday`.                                                    |
| `--dry-run`                                  | Xem kế hoạch, không ghi file.                                                                 |
| `--yes`                                      | Nhận defaults được gợi ý và bỏ qua xác nhận.                                                  |

Lịch iteration trong màn hình tương tác dùng 14 ngày, demo vào ngày cuối.
Metadata lịch không đổi thứ tự AC hay gate TDD.

Nếu có manifest, cấu hình trong đó được ưu tiên hơn các flag setup. Developer
chỉnh manifest để đổi lựa chọn rồi chạy cook lại. Khi chuyển sang tài nguyên repo,
đổi các role Claude từ `verid:<name>` thành `verid-<name>`.
Tên reviewer Codex vẫn là `verid_reviewer`.

## Xem trước khi ghi

```sh
verid cook --mode prep --resources repo --provider codex --dry-run
```

Bản xem trước hiện cây file: `+` tạo mới, `~` cập nhật, `=` giữ lại, `!` là ghi chú.
Xác nhận để áp dụng kế hoạch đã kiểm tra. Nội dung chỉ dẫn có sẵn nằm ngoài cặp
`<!-- verid:begin -->` và `<!-- verid:end -->` được giữ nguyên.

## Mode và drive

| Mode     | Điểm bắt đầu  | Công việc đầu tiên                                                               |
| -------- | ------------- | -------------------------------------------------------------------------------- |
| `prep`   | Ý tưởng       | Research, làm rõ, spec và design.                                                |
| `recipe` | Đặc tả có sẵn | Kiểm tra đầu vào rồi design và plan.                                             |
| `remix`  | Code có sẵn   | Ghi baseline bằng `verid stock`.                                                 |
| `reheat` | Hệ cũ         | Cài adapter, rồi `verid reheat inventory`. Xem [mode reheat](reheat-mode.vi.md). |

`big-brain` để developer order và serve. `no-brain` bắt đầu khi developer ký research,
spec và design bằng `verid order`. Harness review plan rồi làm từng module.
Câu hỏi chặn tiến độ được ghi vào `.verid/blocked.md`; developer xử lý rồi tiếp tục
bằng `verid order`.
