# Kiểm trong CI

Gate của verid chạy trên máy developer, qua hook; một pull request đẩy từ máy không có hook thì
không có gì kiểm. `verid doctor --ci` kiểm, trong CI của project, những gì riêng repo chứa:
manifest, các file verid đã commit, khối hướng dẫn, runner test của mỗi repo, thứ tự phụ thuộc
trong plan, và mọi yêu cầu của spec đều được một AC dẫn tới. Có mục nào hỏng thì thoát 1.

Lệnh này không thay hook. Bằng chứng TDD, approval và kết quả review nằm trong `.verid/.state/`,
không bao giờ commit, nên CI không thấy. Nó cũng bỏ qua những gì thuộc riêng một máy: nối dây
hook, plugin và agent đã cài, trust của Codex hay Antigravity.

## GitHub Actions

Với project cook bằng `--resources repo` (CLI đã commit ở `.verid/verid.mjs`):

```yaml
name: verid
on: [push, pull_request]
jobs:
  verid:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: node .verid/verid.mjs doctor --ci
```

Thay `npm ci` và `npm test` bằng lệnh cài và lệnh test của project. Với `--resources installed`,
cài verid trong job trước rồi chạy `verid doctor --ci`.

## Output

Mỗi phát hiện một dòng, không màu, theo ngôn ngữ của project. Phát hiện về truy vết nêu mã, ví dụ
`! SPEC_UNCOVERED: REQ-9: no AC or Review Focus line in .verid/plan.md cites it`, kèm cách sửa.
