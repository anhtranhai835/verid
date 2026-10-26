```
 ██╗   ██╗ ███████╗ ██████╗  ██╗ ██████╗
 ██║   ██║ ██╔════╝ ██╔══██╗ ██║ ██╔══██╗
 ██║   ██║ █████╗   ██████╔╝ ██║ ██║  ██║
 ╚██╗ ██╔╝ ██╔══╝   ██╔══██╗ ██║ ██║  ██║
  ╚████╔╝  ███████╗ ██║  ██║ ██║ ██████╔╝
   ╚═══╝   ╚══════╝ ╚═╝  ╚═╝ ╚═╝ ╚═════╝
     hook-enforced TDD for Claude Code and Codex · RAW → COOKING → PLATED
```

# verid: TDD cho Claude Code và Codex

[English](README.md) · **Tiếng Việt**

> Agent làm việc. verid kiểm chứng. Developer duyệt.

## Vì sao

Coding agent khi vội thường bỏ qua test: viết code trước, hoặc nới test cho tới khi nó xanh. Prompt chỉ yêu cầu được TDD; hook thì từ chối được lần ghi. verid hỗ trợ Claude Code và Codex, giữ agent đi đúng vòng RED → GREEN → REFACTOR của skill `test-driven-development` trong [superpowers](https://github.com/obra/superpowers), dưới tên RAW → COOKING → PLATED. Bên trong verid luôn fail-closed; giới hạn lỗi host và độ tin cậy của Codex được nêu bên dưới. Chỉ developer mở được ngoại lệ trong Claude Code, và audit log có hash chain ghi lại điều đó. Project có thêm `.verid/`, block ngắn trong file chỉ dẫn của từng provider, `.claude/commands/verid/` cùng `.claude/settings.local.json` riêng của máy cho Claude Code, hoặc `.codex/hooks.json` riêng của máy cho Codex.

## Yêu cầu

- Node.js 22 trở lên, và [Claude Code](https://claude.com/claude-code) hoặc Codex CLI (đã thử với 0.164.0).
- Plugin superpowers, nơi có các skill mà verid chỉ agent tới.
- Plugin andrej-karpathy-skills, nơi có skill `karpathy-guidelines` mà verid gọi.
- Plugin verid: các agent researcher, architect, planner, tester, coder, qa và reviewer mà `verid cook` ánh xạ vào các vai trò, cùng một skill cho mỗi bước. Agent nào khác cũng nhận được vai trò qua `roles`; researcher, architect, planner và qa là tuỳ chọn. Auto của Claude Code cần reviewer, tester và coder; auto chỉ dùng Codex cần reviewer.

```bash
claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace
claude plugin marketplace add forrestchang/andrej-karpathy-skills
claude plugin install andrej-karpathy-skills@karpathy-skills
claude plugin marketplace add anhtranhai835/verid
claude plugin install verid@verid
```

## Cài đặt

Windows (PowerShell 5.1+):

```powershell
irm https://raw.githubusercontent.com/anhtranhai835/verid/main/install.ps1 | iex
```

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/anhtranhai835/verid/main/install.sh | sh
```

Script yêu cầu Node 22+, cài verid bằng npm và thêm cả ba plugin nếu có `claude` trên PATH. Khi có terminal và `CI` rỗng, `false` hoặc `0`, script hỏi thư mục project rồi chạy `verid cook`; trả lời rỗng thì kết thúc mà không chọn thư mục. Script từ chối thư mục home. Trường hợp khác, script in bước tiếp theo.

Đặt `VERID_VERSION` để ghim bản phát hành (mặc định: `latest`): `$env:VERID_VERSION = '1.1.0'` trước lệnh PowerShell, hoặc `curl -fsSL https://raw.githubusercontent.com/anhtranhai835/verid/main/install.sh | VERID_VERSION=1.1.0 sh`. Sau đó xoá biến ghim trong PowerShell bằng `Remove-Item Env:VERID_VERSION`.

Hoặc cài trực tiếp:

```bash
npm install -g @anhtranhai835/verid
```

Từ bản clone: `npm ci`, `npm run build`, `npm link` (hoặc `bun install --frozen-lockfile`, `bun run build`, `bun link`). Hook trỏ vào `dist/` của bản đã cài, nên hãy chạy `verid upgrade --yes` trong mỗi project sau khi nâng cấp, chuyển bản clone sang chỗ khác, hoặc đổi giữa bản npm và bản clone.

## Bắt đầu nhanh

Trong terminal của bạn, ở project cần bảo vệ:

```bash
verid cook     # chọn provider, ngôn ngữ, mode và, ở prep và recipe, drive
verid stock    # chỉ remix: ghi lại các test đã đỏ từ trước
```

Rồi mở provider đã chọn và nói bạn muốn làm gì. Với Codex, hoàn tất bước tin cậy bên dưới trước. Mỗi thông báo của verid đều nêu lệnh tiếp theo; `verid menu` cho biết project đang ở đâu.

Ở monorepo, commit `.verid/manifest.yaml`, `.verid/.gitignore`, file chỉ dẫn của provider được chọn (`CLAUDE.md` / `AGENTS.md`), `.claude/commands/verid/` khi dùng Claude Code và, ở prep và recipe, `.verid/research.md`, `.verid/design.md` cùng `.verid/plan.md`. Giữ `.claude/settings.local.json` và `.codex/hooks.json` riêng trên máy: chúng ghi đường dẫn verid của máy bạn. Người trong team chạy `verid cook` một lần sau khi clone. File của workspace được nêu bên dưới.

## Provider và Codex

`providers` mặc định là `[claude-code]`, kể cả manifest cũ. Chọn provider khi chạy `verid cook`, hoặc lặp cờ `--provider`: `verid cook --provider claude-code --provider codex --mode prep --yes`. Với project đã có, sửa `providers` trong `.verid/manifest.yaml`, rồi chạy `verid upgrade --yes`.

Cook và upgrade chỉ tạo hoặc cập nhật block giữa `<!-- verid:begin -->` và `<!-- verid:end -->` trong `CLAUDE.md` cho Claude Code và `AGENTS.md` cho Codex. Mọi nội dung ngoài block được giữ nguyên; verid không chép skill hay agent vào project. Block chỉ tới quy trình, lệnh, state và allowlist; `verid doctor` báo block thiếu hoặc đã đổi. Agent được sửa phần còn lại của file khi giữ nguyên block.

Chọn Codex tạo `.codex/hooks.json` cho PreToolUse, UserPromptSubmit, Stop, SubagentStop và SessionStart, với đường dẫn hook của bản cài này và timeout chỉ rõ. Nó cũng ghép block có dấu `[agents.verid_reviewer]` vào `~/.codex/config.toml` (hoặc `$CODEX_HOME/config.toml`), trỏ tới overlay reviewer đi kèm verid. TOML khác giữ nguyên; không chép agent hay skill vào project. Block `AGENTS.md` nêu đường dẫn skill tuyệt đối của từng bước trong bản cài này, như `plugin/skills/review/SKILL.md`.

Trong terminal của bạn, chạy `verid cook --provider codex --mode prep --yes`, rồi mở Codex trong project, tin cậy project và dùng `/hooks` để xem và tin cậy từng hook verid. Chạy `verid doctor` để kiểm đường dẫn, tin cậy project, mục tin cậy hook, định nghĩa reviewer và phiên bản Codex. Sau khi nâng cấp hay chuyển verid, chạy `verid upgrade --yes`, xem lại hook đã đổi trong `/hooks`, rồi chạy doctor. Setup không bao giờ ghi cờ bỏ qua tin cậy.

Trên Codex, luồng chính viết cả test lẫn code qua cùng cổng TDD; việc tách tester/coder tắt bất kể ánh xạ vai trò cho Claude Code. Gọi `verid_reviewer` với `fork_turns: "none"` và chỉ AC của module, đường dẫn `.verid/design.md` cùng diff. Thông điệp SubagentStop cuối của nó được ghi làm review; reviewer chỉ đọc và kết thúc bằng `Verdict: pass` hay `Verdict: fail`. Allowlist skill chỉ là chỉ dẫn trên Codex vì kích hoạt skill không có lần gọi để hook chặn. `/verid tip` và `/verid confirm` không có tác dụng ở đó: ngoại lệ cần Claude Code. Dùng `verid peek` và `verid menu` trong terminal.

Codex nhận từ chối PreToolUse bằng JSON cùng mã thoát 0, và giữ Stop bằng `decision: "block"`. Lệnh PowerShell mang tên `Bash` phải qua mọi luật Bash sẵn có cùng bước kiểm đích ghi PowerShell; mọi đích của tool `apply_patch` phải qua luật đường dẫn, vai trò và TDD. Patch đưa qua shell (`apply_patch <<'EOF'`, chương trình `.exe`/`.bat`/`.cmd`, mọi đoạn `*** Begin Patch`) bị từ chối, vì Codex áp nó từ `workdir` hay `cd` mà hook không thấy. Tool được hỗ trợ: `Bash`, `apply_patch`, `collaborationspawn_agent`, `collaborationwait_agent`, `update_plan`, `Read`, `Grep`, `Glob` và tool MCP (`mcp__*`); tool khác, patch sai cú pháp và shell động không đọc được bị từ chối. Kẽ hở Codex nằm trong mục Giới hạn.

## Bố cục

`monorepo` là mặc định: một cây project, đường dẫn repo tính từ gốc project. `workspace` là thư mục không có `.git` riêng, chứa các repo tách biệt:

```text
project/ (.git)              workspace/ (không có .git)
├── api/                    ├── api/ (.git)
├── web/                    ├── web/ (.git)
├── .verid/                 ├── .verid/ (.git)
└── .claude/                └── .claude/ (riêng từng máy)
```

Cook nhận diện workspace khi thư mục nằm ngoài git work tree (hoặc repo tổ tiên có gốc tại thư mục home của người dùng để lưu dotfiles ở `~`) và có ít nhất một repo con trực tiếp. `--layout monorepo|workspace` chọn rõ cho manifest mới; manifest đã có giữ nguyên layout. Cài đặt workspace, dù chọn tường minh, tự nhận diện hay đọc từ manifest, bị từ chối khi nằm trong bất kỳ repo git tổ tiên nào khác. Home lấy từ `os.homedir()` của Node (`USERPROFILE` trên Windows, không phải `HOME` của Git). Workspace không được có `.git` riêng; chỉ repo con được nhận diện. Bản xem trước nêu layout, rồi cook khởi tạo repo git trong `.verid/` mà không commit. Commit file dùng chung trong `.verid/`; các file `.claude/` ở gốc được tạo trên mỗi máy. Mở Claude Code tại gốc workspace.

`CLAUDE.md` / `AGENTS.md` của workspace nằm tại gốc workspace, ngoài repo `.verid` dùng chung. Chúng thuộc mỗi máy; `verid cook` tạo lại block verid và giữ nội dung người dùng.

Cook ghi origin của mỗi repo con sau khi bỏ userinfo (kể cả mật khẩu và token); chỉ giữ user SSH thông dụng `git@` khi không có mật khẩu, ở URL SSH và remote kiểu scp. `default_branch` chỉ lấy từ `origin/HEAD` cục bộ; thiếu thì để trống trường này.

Đồng đội clone repo dùng chung vào `workspace/.verid`, rồi chạy `verid cook` **từ `workspace/`**. Bản xem trước, kể cả `--dry-run`, liệt kê mỗi lần clone dạng `path <- remote (branch)` khi có nhánh. Git dùng terminal và cấu hình SSH của developer, có thể hỏi xác nhận và không bị giới hạn thời gian clone. Clone chỉ cho phép giao thức `https`, `ssh`, `git` và `file` cục bộ; từ chối thư mục mạng (UNC, `//host/...`, URL `file://` có host) và remote bắt đầu bằng `-`.

Cook giữ thư mục đã có, tiếp tục sau một lần clone lỗi và thoát 1 nếu có lỗi hoặc thiếu remote. Trước khi clone, verid ghi dấu riêng cho repo trong `.verid/.state/clones/` được bảo vệ và xoá dấu sau khi clone thành công hoặc xác nhận thư mục clone lỗi đã được xoá. Clone lỗi chỉ xoá thư mục đích do chính lần gọi đó tạo; chạy lại để thử các thư mục còn thiếu, xoá dấu cũ trước khi thử. Thư mục đã có và mang dấu được chấp nhận, đồng thời xoá dấu, khi `HEAD` trỏ tới một commit, đã có checkout và index khớp `HEAD` (`git diff --cached --quiet HEAD`). Nếu không, đó là clone chưa hoàn chỉnh, kể cả sau Ctrl-C: lưu lại công việc cần giữ, hoàn tất checkout hoặc xoá thư mục đó rồi chạy lại `verid cook`. Repo mới chưa có commit vẫn hợp lệ, nên workspace prep mới cài đặt xong với mã thoát 0; repo đã có và không mang dấu thì báo đã cài đặt. `--dry-run` chỉ xem trước việc clone và khởi tạo `.verid`, không ghi gì.

Glob của hook và lần chạy taste tính từ từng repo. qa ghi được đường dẫn khớp `e2e_globs` trong bất kỳ repo nào; skill build mặc định chọn `role: frontend`, hoặc repo `role: e2e` được chỉ định. Mọi repo dùng chung một vòng TDD. Auto kiểm tree sạch của từng repo đã liệt kê và repo `.verid`, đồng thời ghi nhận git riêng từng repo lúc ký; mất git sau khi ký thì repo đó vẫn tính là bẩn. Doctor cũng báo từng repo và `.verid`.

## Mode

| Mode     | Bắt đầu từ                | verid thêm                                                                                                                                                                                                      |
| :------- | :------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prep`   | một ý tưởng, chưa có code | nghiên cứu trong `.verid/research.md`, thiết kế trong `.verid/design.md`, rồi các module trong `.verid/plan.md`, mỗi module được duyệt, review rồi đóng, và cuối cùng là module `product` gồm các AC end-to-end |
| `recipe` | một bản đặc tả            | các bước như trên, với các module lấy từ đặc tả                                                                                                                                                                 |
| `remix`  | code và test có sẵn       | baseline của các test đã đỏ từ trước verid                                                                                                                                                                      |

Ở prep và recipe, trường `iterations` tuỳ chọn trong manifest nhóm plan theo các khoảng ngày. Mỗi module có thể thêm một dòng `Iteration: 1` làm dòng không rỗng đầu tiên sau tiêu đề, kể cả `product`; bật iterations vẫn không bắt buộc dòng này và số phải là số nguyên dương. Mọi dòng phía sau là văn bản thường. Khi tắt iterations, không dòng `Iteration:` nào được phân tích, nên plan cũ và drive đang chạy giữ nguyên hành vi. Planner xếp module cho vừa thời lượng đã đặt và hỏi developer khi công việc không vừa.

`verid menu` và thông báo đầu phiên hiện iteration hiện tại cùng ngày bắt đầu và kết thúc, số ngày tới lần cuối của thứ demo trong iteration này, số module đã đóng/tổng của iteration này và module thuộc iteration trước chưa đóng, đánh dấu trễ. Đúng ngày demo hiện `hôm nay`, sau đó hiện `demo đã qua`; khoảng không chứa thứ đã chọn dùng ngày kết thúc. Các khoảng bắt đầu từ `start_date`, kéo dài theo số ngày lịch đã đặt và tính cả ngày kết thúc; trước ngày bắt đầu vẫn hiện iteration 1 cùng demo của nó. Hôm nay lấy theo ngày địa phương của máy.

## Drive: human hay auto

Ở prep và recipe, trường `drive` trong manifest nói ai đưa project đi từ module này sang module khác; `verid cook` hỏi điều này sau khi chọn mode.

| Drive              | Ai đưa project đi                                                                                                                                                              |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `human` (mặc định) | developer: `verid order <module>` mở từng module, `verid serve <module>` đóng nó                                                                                               |
| `auto`             | agent: nó lập plan, làm và review mọi module, `product` cuối cùng, và chỉ dừng khi kẹt. Claude Code cần reviewer, tester, coder trong `roles`; chỉ dùng Codex thì cần reviewer |

Drive auto:

1. **Hỏi.** Agent hỏi các câu research và design rồi ghi `.verid/research.md` và `.verid/design.md`. Khi chưa ký, code production bị khoá và drive không giữ agent (các lần giữ thông thường vì test đỏ, stub hay thay đổi chưa chạy vẫn áp dụng).
2. **Ký.** Developer đọc cả hai và chạy `verid order` (không kèm module) trong terminal của mình; verid ghi sha256 của chúng. Trừ khi drive bị kẹt, đó là lệnh duy nhất developer phải gõ.
3. **Plan.** Agent viết `.verid/plan.md`, kết thúc bằng `product`, và reviewer review nó so với design. Bản review kết thúc bằng `Verdict: pass` hoặc `Verdict: fail`; thiếu dòng này tính là fail. Code production vẫn bị khoá cho tới khi plan pass.
4. **Làm.** verid mở module đầu tiên chưa đóng, theo thứ tự trong plan. Trên Claude Code, tester (qa cho AC `(e2e)` khi có ánh xạ) và coder làm từng AC theo kiểu test trước; trên Codex, luồng chính làm cả hai. Agent commit module trên `feat/<module>`, rồi reviewer review nó. Nhánh là chỉ dẫn của skill; bước kiểm tree sạch của hook không đổi.
5. **Đóng.** verid đóng module khi mọi AC có test pass, lần chạy cuối pass và không có thay đổi nào sau nó, review sau lần sửa cuối kết luận pass, và git sạch: cây con của project cùng các repo đã liệt kê ở monorepo, mọi repo đã liệt kê cùng `.verid` ở workspace (file chưa track cũng tính, `.claude/settings.local.json` thì không). Module kế tiếp mở; drive xong khi `product` đóng sau cùng, và một module đóng sau `product` sẽ mở lại `product`.

Stop giữ agent mọi lần, nói bước kế tiếp, cho tới khi drive xong hoặc kẹt. `verid menu` và thông báo đầu phiên cho thấy drive (đã ký chưa, plan đã duyệt chưa, các module, bộ đếm n/3, bước kế tiếp hoặc vì sao kẹt); `verid peek` cho thấy vòng TDD và bước kế tiếp.

**Giới hạn.** Mọi vòng lặp dừng ở 3: review plan fail, lượt coder cho mỗi AC (một lượt kết thúc khi coder dừng mà còn test đỏ mang tên AC), review module fail, và các lần Stop giữ liên tiếp mà không tiến triển (test, plan, commit và bộ đếm không đổi). Bộ đếm về 0 khi vòng lặp của nó pass; riêng bộ đếm không tiến triển về 0 khi kết quả đổi.

**Kẹt** khi `.verid/blocked.md` có chữ (agent ghi khi chỉ developer trả lời được, hoặc developer ghi để tạm dừng), đạt một giới hạn, `.verid/research.md` hoặc `.verid/design.md` khác bản đã ký, hoặc phần plan của một module đã đóng bị sửa hay bị xoá. Lần đầu một hook thấy `.verid/blocked.md` (ở bất kỳ lần Stop nào, hay lần gọi tool nào có ghi file, kể cả lệnh Bash `rm` chính file đó), verid chốt lời khai kẹt vào `.verid/.state/`, nên xoá file cũng không gỡ được; bộ đếm đạt giới hạn cũng giữ nguyên cho tới `verid order`. Hai nguyên nhân sau cùng được đọc lại từ chính các file, nên trả chúng về bản cũ là gỡ được. Khi kẹt, code production và test bị khoá (`VERID_BURNT_AUTO_STUCK`), và Stop cho agent dừng rồi báo developer lý do, như khi xong.

**Chạy tiếp** bằng `verid order`: nó ký lại, đặt lại các bộ đếm, xoá `.verid/blocked.md` và bỏ bản review của module đang mở. Plan chỉ giữ nguyên là đã duyệt khi research và design không đổi; module đã đóng mà phần plan của nó bị sửa thì được mở lại, còn module plan đã bỏ thì bị quên đi.

**Từ chối.** Khi không có module nào đang mở, code production bị khoá (`VERID_BURNT_AUTO_NO_MODULE`). Ở auto, `verid order <module>` và `verid serve` từ chối (`VERID_BURNT_AUTO_ORDER_MODULE`, `VERID_BURNT_AUTO_SERVE`), và `verid order` từ chối khi còn thiếu research hay design (`VERID_BURNT_RESEARCH_MISSING`, `VERID_BURNT_DESIGN_MISSING`).

**Esc và đổi drive.** Bấm Esc để hỏi agent giữa chừng: Stop không chạy khi bị ngắt, và giữ agent lại sau khi nó trả lời. Muốn đổi drive, sửa `drive:` trong `.verid/manifest.yaml`. Module đã đóng vẫn là đã đóng; từ human sang auto cần ký và một lần review plan; từ auto sang human thì module đang mở cần `verid order <module>`.

## Các lệnh

| Lệnh                                | Ai chạy                      | Làm gì                                                                                                                                              |
| :---------------------------------- | :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verid cook [--dry-run] [--yes]`    | developer                    | xem trước cài đặt cho project và máy này; đề nghị thêm mặc định mới vào manifest cũ                                                                 |
| `verid upgrade [--dry-run] [--yes]` | developer                    | thêm mặc định manifest còn thiếu, tạo lại lệnh của verid và cập nhật đường dẫn hook của máy này                                                     |
| `verid doctor`                      | mọi người                    | kiểm tra Node, repo, thay đổi chưa commit, `default_branch` nếu đặt, runner, hook, block chỉ dẫn provider và plugin; chỉ đọc, thoát 1 khi có vấn đề |
| `verid taste`                       | agent                        | chạy test; chỉ những lần chạy này mới là bằng chứng                                                                                                 |
| `verid peek`                        | ai cũng được                 | vòng TDD, bước tiếp theo, và vì sao lần chạy gần nhất không được tính                                                                               |
| `verid menu`                        | ai cũng được                 | nghiên cứu, các module và độ phủ AC, câu hỏi còn mở, bước tiếp theo                                                                                 |
| `verid stock`                       | developer                    | remix: ghi các test đang đỏ làm baseline                                                                                                            |
| `verid order [module]`              | developer                    | prep, recipe: duyệt một module của `.verid/plan.md`, ký cả `.verid/design.md`; auto: ký research và design, và chạy tiếp sau khi dừng               |
| `verid serve <module>`              | developer                    | prep, recipe, chỉ drive human: đóng module đang mở khi mọi AC đã pass và reviewer đã review nó sau lần sửa cuối; in đường dẫn của bản review        |
| `verid garnish`                     | developer                    | mở code production cho cuộc hội thoại chỉ để refactor                                                                                               |
| `/verid:tip <lý do>`                | developer, trong Claude Code | xin cho hành động vừa bị chặn đi qua, kèm một mã dùng một lần                                                                                       |
| `/verid:confirm <mã>`               | developer, trong Claude Code | cho đúng hành động đó qua một lần                                                                                                                   |
| `/verid:peek`, `/verid:menu`        | developer, trong Claude Code | những gì `verid peek` và `verid menu` hiện, chỉ cho bạn xem                                                                                         |

`verid cook` nhận cờ lặp được `--provider claude-code|codex`, `--mode prep|recipe|remix`, `--drive human|auto`, `--layout monorepo|workspace`, `--lang vi|en`, `--test-cmd` (lệnh test của riêng bạn) và glob `--src`/`--tests` (lặp lại được), và tự hỏi khi chạy trong terminal mà không có cờ nào. Ở prep hay recipe, thêm `--iterations --duration "2 weeks" --start-date 2026-10-12 --demo-day Friday`, cung cấp đủ ba giá trị; luồng tương tác hỏi sau drive. Khi manifest đã có, `--provider`, `--mode`, `--drive`, `--layout`, `--iterations`, `--duration`, `--start-date`, `--demo-day`, `--test-cmd`, `--src` và `--tests` bị bỏ qua kèm một ghi chú: hãy sửa `.verid/manifest.yaml` bằng tay. Lệnh của developer từ chối trong Claude Code và shell Codex nhận diện được; hook cũng chặn lần gọi developer nhận diện được.

Cook và upgrade hiện cây file trước khi ghi: `+` tạo, `~` sửa, `=` giữ, `!` ghi chú. Trong terminal, xác nhận bằng `Áp dụng? (Y/n)`; nếu file đổi trong lúc chờ, verid hiện plan mới rồi hỏi lại. `--dry-run` không ghi gì; `--yes` bỏ qua câu hỏi, áp dụng plan mới nhất và nhận mặc định, gồm mode gợi ý cho project mới (prep, hoặc remix nếu có src/, lib/ hay app/). `--dry-run` của project mới cũng dùng gợi ý đó nếu chưa đặt `--mode`. Không có terminal, cook vẫn chạy với mode chỉ rõ hoặc manifest đã có; upgrade cần `--yes` để ghi. Upgrade thay các chỉnh sửa riêng trong bốn lệnh verid được tạo sẵn; cook giữ chúng.

## Plugin

Plugin quy trình nối các công cụ với verid bằng script Node. Chúng tách biệt với plugin Claude Code cung cấp skill và agent. Mọi nguồn đều không chính thức và chạy với quyền người dùng của bạn; hãy xem nguồn trước khi đồng ý. Mọi lệnh `verid plugin` dành cho developer và từ chối trong Claude Code cùng shell Codex nhận diện được.

```sh
verid plugin add ./my-plugin --yes       # hoặc file:../my-plugin
verid plugin add git:https://example.com/team/plugin.git#v1 --yes
verid plugin add npm:@team/verid-board@1.0.0 --yes
verid plugin list                       # plugin doctor kiểm script và công cụ cần có
verid plugin run taste                  # JSON mẫu, có sample: true
verid plugin remove board               # giữ dữ liệu
```

Add hiện tên, phiên bản, sự kiện, lệnh cần có và nguồn rồi hỏi có cài không; `--yes` đồng ý. Không có terminal thì cần `--yes`. Không có registry, lệnh setup hay tự cài công cụ. Commit `.verid/plugins.json` (mảng các `{ "name", "source", "resolved" }`) và `.verid/plugin-data/<name>/`. Code tải về và bản tạm nằm trong `.verid/plugins/`, được `.verid/.gitignore` bỏ qua. Cook và upgrade khôi phục code còn thiếu hoặc đã đổi với cùng bước xác nhận; `--dry-run` chỉ xem trước. Git khôi phục đúng commit đã ghi, npm đúng phiên bản đã ghi. Git dùng giới hạn clone của workspace và terminal kế thừa; thông tin người dùng trong remote bị bỏ trước khi tải hay lưu.

Khi developer add, remove hoặc xác nhận khôi phục, verid ghi bản duyệt SHA-256 vào `.verid/.state/plugin-integrity.json`: byte chính xác của `plugins.json` và đường dẫn tương đối cùng nội dung mọi file plugin, sắp theo đường dẫn. Chỉ thư mục riêng của plugin được băm; các dependency được phân giải từ bên ngoài thư mục đó không được băm. Agent không đọc hay ghi được state đó qua file tool hoặc đường dẫn MCP nhận diện được. Trước mỗi script, kể cả `plugin run` và sự kiện từ hook, verid so sánh các file với bản duyệt. Thiếu bản ghi hoặc không khớp thì bỏ qua thực thi, ghi cảnh báo vào audit và yêu cầu developer xem nguồn rồi duyệt lại bằng `verid plugin add` (gỡ bản đã cài trước), hoặc khôi phục bằng `verid cook` / `verid upgrade`. `verid plugin doctor` báo các sai lệch. Thêm hoặc gỡ plugin khác giữ bản duyệt hiện có, không tự duyệt code đã đổi.

Thư mục plugin chứa `verid-plugin.json` và các script:

```json
{ "name": "board", "version": "1.0.0", "events": { "taste": "taste.mjs" }, "requires": ["node"] }
```

Manifest chỉ nhận các trường này: tên kebab-case dùng được trên các hệ điều hành, phiên bản, sự kiện đã biết với đường dẫn script tương đối, và tên lệnh trên PATH nếu cần. Đường dẫn không được tuyệt đối, chứa `..` hay đi qua link. Script chạy bằng Node trong thư mục plugin đã tải, nhận JSON qua stdin và thư mục tuyệt đối `VERID_PLUGIN_DATA`. Ví dụ `taste.mjs`:

```js
import fs from "node:fs";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
fs.appendFileSync(`${process.env.VERID_PLUGIN_DATA}/events.jsonl`, raw + "\n");
```

Các sự kiện: `module-opened` và `module-served` (`module`), `taste` (`passed`, `counts: { passed, failed, skipped }` cho lần chạy hợp lệ), `drive-stuck` (`reason`) và `drive-done`. Payload luôn có `event`; `plugin run` gửi mẫu. Chuyển trạng thái auto được quan sát sau khi Stop hay SubagentStop lưu quyết định. Output của script bị bỏ qua; fail, crash và timeout được ghi audit và cảnh báo, giữ nguyên quyết định của verid. Mỗi sự kiện CLI dùng chung năm giây; mọi sự kiện và plugin trong một hook dùng chung một giây.

File tool và MCP writer nhận diện được không được sửa nguồn, code tải về **hay dữ liệu** plugin, kể cả với `/verid tip`. Bash nhắc các đường dẫn plugin đó hoặc gọi `verid plugin`, kể cả điểm vào npm có phiên bản và dấu phân cách `--` tuỳ chọn, được bảo vệ không override được như vậy. Dữ liệu có thể chọn lệnh hay cấu hình công cụ, nên cũng được bảo vệ khỏi các lần ghi đó. Developer và script plugin được cập nhật dữ liệu; dữ liệu nằm ngoài bản duyệt nội dung.

## Cách hoạt động

### Ba nguyên tắc

1. **Không có code production khi chưa có test fail.** Code production bị khoá khi vòng đang ở RAW, và ở prep và recipe khi chưa có module nào được duyệt. Khi đang có test fail, các test bị đóng băng.
2. **Bằng chứng trước khi tuyên bố xong.** Chỉ lần chạy `verid taste` có mã thoát khớp với báo cáo JUnit mới được tính. Ở drive human, agent không dừng được khi lần chạy gần nhất đang fail hoặc sau một thay đổi chưa lần chạy nào thấy; drive auto tự giữ mọi lần Stop.
3. **Chỉ developer mở được ngoại lệ.** Trong Claude Code, `/verid tip` chỉ dùng được khi có người ngồi ở bàn phím, không bao giờ từ subagent hay `claude -p`. Mỗi ngoại lệ cho một hành động qua một rule, một lần: lệnh vướng hai rule thì cần hai lần. Codex không tạo được override.

### Vai trò

Claude Code đặt một `agent_type` vào mỗi lần gọi tool từ subagent; `roles` ánh xạ các agent type đó sang vai trò. Có cả tester lẫn coder thì việc được tách. Codex dùng luồng chính ghi và reviewer chỉ đọc, không tách tester/coder:

| Ai ghi                                                 | Code production    | Test                                            | File khác (docs, config, `.verid/*.md`) |
| :----------------------------------------------------- | :----------------- | :---------------------------------------------- | :-------------------------------------- |
| reviewer                                               | `ROLE_READ_ONLY`   | `ROLE_READ_ONLY`                                | `ROLE_READ_ONLY`                        |
| researcher                                             | `ROLE_DOC_ONLY`    | `ROLE_DOC_ONLY`                                 | chỉ `.verid/research.md`                |
| architect                                              | `ROLE_DOC_ONLY`    | `ROLE_DOC_ONLY`                                 | chỉ `.verid/design.md`                  |
| planner                                                | `ROLE_DOC_ONLY`    | `ROLE_DOC_ONLY`                                 | chỉ `.verid/plan.md`                    |
| qa                                                     | `ROLE_QA_E2E_ONLY` | e2e theo cổng TDD; test khác `ROLE_QA_E2E_ONLY` | `ROLE_QA_E2E_ONLY`                      |
| khi tách: coder                                        | theo cổng TDD      | `ROLE_TESTER_ONLY`                              | được                                    |
| khi tách: tester                                       | `ROLE_CODER_ONLY`  | theo cổng TDD                                   | được                                    |
| khi tách: luồng chính, agent khác                      | `ROLE_CODER_ONLY`  | `ROLE_TESTER_ONLY`                              | được                                    |
| khi không tách: luồng chính, tester, coder, agent khác | theo cổng TDD      | theo cổng TDD                                   | được                                    |

- Lần gọi không có `agent_id` là của luồng chính, kể cả khi chạy `claude --agent X`. Luật vai trò xét trước cổng TDD: vai trò nói ai, vòng TDD nói lúc nào.
- Khi reviewer dừng lúc có module đang mở, verid ghi báo cáo cuối của nó vào `.verid/.state/reviews/`; một lần ghi code hay test sau đó, hoặc một lần `verid order` mới, làm bản review đó mất hiệu lực.
- Subagent đã ghi code hay test bị giữ lại một lần nếu dừng khi còn test fail, stub đang mở hoặc thay đổi chưa chạy; tester khi tách và qa không bị giữ vì test fail hay stub.
- qa và tester đều ghi được test end-to-end khi tách. Với mọi người ghi, chỉ đường dẫn khớp `e2e_globs` được tính là test end-to-end ở cổng ghi, kể cả test Playwright; cổng TDD vẫn xét các file này.
- `verid:design` gọi researcher rồi architect đã ánh xạ, `verid:plan` gọi planner đã ánh xạ. Luồng chính trình bản đề xuất, chuyển câu hỏi từng câu cho developer, rồi mới nhờ agent ghi. Bước chưa ánh xạ vẫn làm ở luồng chính. `verid:build` gợi ý `feat/<module>` cho mỗi module.

### Vòng TDD

| Trạng thái        | Code production  | Test            | `verid taste` fail                                                        | `verid taste` pass |
| :---------------- | :--------------- | :-------------- | :------------------------------------------------------------------------ | :----------------- |
| RAW (RED)         | bị khoá          | ghi được        | → COOKING nếu có lỗi assertion mới; → RAW · stub nếu test không load được | giữ RAW            |
| RAW · stub (RED)  | mở, chỉ cho stub | ghi được        | → COOKING nếu có lỗi assertion; giữ nguyên khi test vẫn không load được   | → RAW              |
| COOKING (GREEN)   | mở               | đóng băng       | giữ COOKING                                                               | → PLATED           |
| PLATED (REFACTOR) | mở               | ghi được, → RAW | → COOKING                                                                 | giữ PLATED         |

- Chỉ lỗi mà lần chạy trước chưa có mới đẩy vòng đi. Cuộc hội thoại mới bắt đầu từ RAW; `verid garnish` mở một cuộc hội thoại chỉ để refactor.
- Ở prep và recipe, đặt mã AC vào tên của test phủ nó: `AC-1 adds two numbers`, hoặc `AC_1_addsTwoNumbers` khi tên không chứa được dấu gạch ngang.
- Ở remix, test trong baseline là lỗi có từ trước và đứng ngoài vòng; test nào pass thì rời baseline luôn.

## Hook chặn gì

| Rule                                 | Override được       | Phạm vi                                                                                                                                                                                                                                                                     |
| :----------------------------------- | :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERID_BURNT_STATE_PROTECTED`        | không               | đọc hoặc ghi `.verid/.state/`                                                                                                                                                                                                                                               |
| `VERID_BURNT_SECRET_PROTECTED`       | không               | file bí mật: `.env*` (trừ file mẫu), key, chứng chỉ, `.ssh/`, `.npmrc`…                                                                                                                                                                                                     |
| `VERID_BURNT_TRANSCRIPT_PROTECTED`   | không               | transcript của Claude Code trong `~/.claude/projects/` hay `CLAUDE_CONFIG_DIR/projects/`                                                                                                                                                                                    |
| `VERID_BURNT_HOOK_PROTECTED`         | không               | ghi `.claude/settings*.json`, `.claude/agents/`, `.claude/plugins/` của project/home, `.claude/skills/` của project / `~/.claude/skills/` và `.claude/commands/` / `~/.claude/commands/`, các đường dẫn tương ứng trong `CLAUDE_CONFIG_DIR`, `dist/` và `plugin/` của verid |
| `VERID_BURNT_PLUGIN_PROTECTED`       | không               | file tool/MCP ghi `.verid/plugins.json`, `.verid/plugins/`, `.verid/plugin-data/` hay chính `.verid/`; Bash nhắc đường dẫn plugin hoặc gọi `verid plugin`                                                                                                                   |
| `VERID_BURNT_MANIFEST_PROTECTED`     | có                  | ghi `.verid/manifest.yaml`                                                                                                                                                                                                                                                  |
| `VERID_BURNT_INSTRUCTIONS_PROTECTED` | có                  | đổi hoặc xoá block verid trong file chỉ dẫn của provider                                                                                                                                                                                                                    |
| `VERID_BURNT_SKILL_NOT_ALLOWED`      | có                  | gọi `Skill` ngoài `verid:*`, `superpowers:*`, `andrej-karpathy-skills:*` và `allowed_skills`                                                                                                                                                                                |
| `VERID_BURNT_AGENT_NOT_ALLOWED`      | có trên Claude Code | gọi `Agent` / `Task` hay `collaborationspawn_agent` của Codex cho type không có trong `roles` và `allowed_agents`                                                                                                                                                           |
| `VERID_BURNT_PATCH_UNSUPPORTED`      | không trên Codex    | `apply_patch` sai cú pháp hay cú pháp lạ, gồm định tuyến environment, hoặc patch đưa qua shell                                                                                                                                                                              |
| `VERID_BURNT_TOOL_UNSUPPORTED`       | không trên Codex    | tool Codex không phải MCP và ngoài danh sách hỗ trợ; thông báo nêu tên tool                                                                                                                                                                                                 |
| `VERID_BURNT_AGENT_CONTEXT`          | không trên Codex    | gọi reviewer với `fork_turns` khác `"none"`                                                                                                                                                                                                                                 |
| `VERID_BURNT_BASH_NESTED_CODEX`      | có trên Claude Code | shell mở một phiên `codex` lồng                                                                                                                                                                                                                                             |
| `VERID_BURNT_BASH_NESTED_CLAUDE`     | có                  | Bash mở một phiên `claude` lồng                                                                                                                                                                                                                                             |
| `VERID_BURNT_BASH_DEVELOPER_ONLY`    | có                  | Bash nhắc tới `CLAUDECODE` hay hook của verid, hoặc chạy lệnh của developer                                                                                                                                                                                                 |
| `VERID_BURNT_SHELL_UNSUPPORTED`      | có trên Claude Code | shell không hỗ trợ của Claude Code, hay dạng PowerShell động của Codex không đọc được lệnh                                                                                                                                                                                  |
| `VERID_BURNT_ROLE_READ_ONLY`         | có                  | mọi lần ghi của reviewer đã ánh xạ                                                                                                                                                                                                                                          |
| `VERID_BURNT_ROLE_TESTER_ONLY`       | có                  | khi tách: test do người khác ngoài tester ghi, trừ qa ghi test end-to-end                                                                                                                                                                                                   |
| `VERID_BURNT_ROLE_CODER_ONLY`        | có                  | khi tách: code production do người khác ngoài coder ghi                                                                                                                                                                                                                     |
| `VERID_BURNT_ROLE_DOC_ONLY`          | có                  | researcher, architect hay planner ghi ngoài tài liệu của mình; thông báo nêu file được phép                                                                                                                                                                                 |
| `VERID_BURNT_ROLE_QA_E2E_ONLY`       | có                  | qa ghi code production, unit test hay file ngoài test end-to-end                                                                                                                                                                                                            |
| `VERID_BURNT_PLAN_NO_RESEARCH`       | có                  | ghi `.verid/plan.md` khi chưa có `.verid/research.md`                                                                                                                                                                                                                       |
| `VERID_BURNT_PLAN_NO_DESIGN`         | có                  | ghi `.verid/plan.md` khi chưa có `.verid/design.md`                                                                                                                                                                                                                         |
| `VERID_BURNT_PLAN_NOT_APPROVED`      | có                  | code production khi không có module nào đang mở (prep, recipe)                                                                                                                                                                                                              |
| `VERID_BURNT_AUTO_NO_MODULE`         | có                  | auto: code production khi không có module nào đang mở                                                                                                                                                                                                                       |
| `VERID_BURNT_AUTO_STUCK`             | có                  | auto: code production và test khi drive đang kẹt                                                                                                                                                                                                                            |
| `VERID_BURNT_TDD_NO_FAILING_TEST`    | có                  | code production khi vòng đang ở RAW                                                                                                                                                                                                                                         |
| `VERID_BURNT_TDD_TEST_FROZEN`        | có                  | test khi vòng đang ở COOKING                                                                                                                                                                                                                                                |

Các rule áp dụng cho tool file, Bash (đích ghi rõ ràng được xét như Write), tool MCP, `Skill`, `Agent`, `Task` của Claude Code, cùng `apply_patch` và `collaborationspawn_agent` của Codex. Codex còn bảo vệ `.codex/` trong project/home, `.agents/skills/` trong project/home và thư mục `plugin/` của verid (skill mà block `AGENTS.md` nêu, cùng template reviewer), coi `~/.codex/sessions/`, `history.jsonl` và các database trạng thái của nó là transcript và `~/.codex/auth.json` là bí mật, kể cả khi chuyển `CODEX_HOME`. Thông báo từ chối nêu allowlist. Trong Claude Code, `/verid tip` của developer cho qua đúng một lần gọi với một rule override được; các rule khác vẫn xét. Codex không có override. Lỗi bất ngờ bên trong verid chặn lần gọi đó.

## manifest.yaml

```yaml
schemaVersion: 1
mode: remix # prep | recipe | remix
providers: [claude-code] # tuỳ chọn: claude-code, codex; mặc định [claude-code]
allowed_skills: [] # tuỳ chọn, bổ sung: tên chính xác hoặc prefix:*
allowed_agents: ["general-purpose"] # mặc định cook; agent type chính xác
roles: # tuỳ chọn: agent type, đúng như Claude Code báo, cho từng vai trò
  reviewer: ["verid:reviewer"]
  tester: ["verid:tester"] # có cả tester lẫn coder thì việc được tách
  coder: ["verid:coder"]
  researcher: ["verid:researcher"] # tuỳ chọn: chỉ .verid/research.md
  architect: ["verid:architect"] # tuỳ chọn: chỉ .verid/design.md
  planner: ["verid:planner"] # tuỳ chọn: chỉ .verid/plan.md
  qa: ["verid:qa"] # tuỳ chọn: chỉ test end-to-end
drive: human # human | auto
layout: monorepo # monorepo | workspace; thiếu thì mặc định monorepo
# iterations: { duration: "2 weeks", start_date: "2026-10-12", demo_day: Friday } # chỉ prep, recipe
repos:
  - path: .
    # remote: https://example.com/team/api.git  # tuỳ chọn: clone repo còn thiếu
    # default_branch: main  # tuỳ chọn: verid doctor kiểm tra nhánh này
    # role: backend  # tuỳ chọn: frontend | backend | e2e | other
    # test_cmd: make test JUNIT={junit}   # tuỳ chọn: không có thì verid tự tìm runner
    source_globs: ["**"] # code production
    test_globs: ["**/test/**", "**/*.test.*", …] # test và cấu hình runner
    ignore_globs: ["**/*.md", "**/*.json", …] # không bao giờ là code production
    e2e_globs: ["**/e2e/**", "**/*.e2e.*"] # test end-to-end
    timeout_sec: 100 # tuỳ chọn
```

- Chỉ developer sửa manifest; `verid cook` ghi các mặc định, trong đó mọi file đều là code, trừ test, tài liệu, dữ liệu, cấu hình, file build và thư mục của tool.
- `providers` là danh sách không rỗng gồm `claude-code` và/hoặc `codex`; upgrade thêm `[claude-code]` vào manifest cũ. Thiếu `allowed_skills` hay `allowed_agents` thì mặc định `[]`. Skill luôn cho phép `verid:*`, `superpowers:*` và `andrej-karpathy-skills:*`; `allowed_skills` bổ sung tên chính xác như `team:lint` hay mẫu namespace như `team:*`. Mọi bên gọi agent chỉ được dùng type chính xác trong `roles` cộng `allowed_agents`. Thêm agent không cấp vai trò đã ánh xạ hay bỏ qua rule ghi file.
- Cook ghi `allowed_agents: ["general-purpose"]` vì các skill superpowers được gọi cần dispatch type này; upgrade đề xuất khi thiếu trường và giữ giá trị đã có. Xoá nó sẽ từ chối các dispatch đó trừ khi `general-purpose` được ánh xạ trong `roles`. Rule vai trò và cổng TDD vẫn áp dụng với nó.
- `iterations` là tuỳ chọn ở prep và recipe: `duration` là số nguyên dương theo sau bởi `day`, `days`, `week` hay `weeks`, `start_date` là ngày thật dạng `YYYY-MM-DD`, và `demo_day` là `Monday` đến `Sunday` (phân biệt hoa thường).
- Đường dẫn repo tính từ project, riêng biệt và không lồng nhau; `./x`, `x/` và dấu phân cách lặp được chuẩn hoá. Đường dẫn workspace chỉ thư mục con. Đường dẫn tuyệt đối, đi lên thư mục cha, tên alias Windows và gốc repo workspace qua link bị từ chối; thư mục project và repo monorepo có thể là link. Mỗi repo có glob, lệnh và timeout riêng; tên test và runner đã ghi nhớ ở workspace kèm đường dẫn repo để phân biệt tên trùng giữa các repo. `remote`, `default_branch` và `role` là tuỳ chọn.
- Mỗi tên trong `roles` chỉ thuộc một vai trò, và trên Claude Code đã có tester thì phải có coder. Không có `roles` thì không ai bị giữ theo vai trò, và `verid serve` từ chối vì thiếu reviewer. `drive: auto` cần prep hay recipe cùng reviewer, tester, coder cho Claude Code, hoặc chỉ reviewer cho project chỉ dùng Codex; researcher, architect, planner và qa là tuỳ chọn. Cook đề xuất mặc định tuỳ chọn còn thiếu, thêm `verid_reviewer` vào `roles.reviewer` khi chọn Codex, và giữ tên đã có.
- Đường dẫn khớp `test_globs` hay `e2e_globs` là test; nếu không, khớp `ignore_globs` thì tự do; nếu không nữa, khớp `source_globs` là code. Glob hỗ trợ `**`, `*`, `?`; một thư mục được viết là `src/**`.
- Một AC viết `- AC-3 (e2e): …` cần một test end-to-end pass: test bất kỳ do Playwright báo, hoặc test của runner khác mà file khớp `e2e_globs`.

Không có `test_cmd` thì verid tìm runner từ các file build ở gốc repo và các thư mục cấp một:

| File build                                     | verid chạy                                   | Không có báo cáo thì agent chạy                             |
| :--------------------------------------------- | :------------------------------------------- | :---------------------------------------------------------- |
| `package.json` có vitest, hoặc jest            | `npx --no vitest run` / `npx --no jest --ci` | `npm install` / `npm install -D jest-junit`                 |
| `playwright.config.*`, hoặc `@playwright/test` | `npx --no playwright test`                   | `npm install -D @playwright/test && npx playwright install` |
| `pytest.ini`, `conftest.py`, `pyproject.toml`  | `python -m pytest`                           | `python -m pip install pytest`                              |
| `pom.xml`, `build.gradle(.kts)`                | `mvn -B -ntp test`, `gradlew test --rerun`   | —                                                           |
| `*.sln`, `*.csproj`                            | `dotnet test`                                | `dotnet add <project> package JunitXml.TestLogger`          |
| `go.mod`                                       | `gotestsum ./...`                            | `go install gotest.tools/gotestsum@latest`                  |
| `phpunit.xml`, phpunit trong `composer.json`   | `php vendor/bin/phpunit`                     | `composer require --dev phpunit/phpunit`                    |
| `.rspec`, rspec trong `Gemfile`                | `bundle exec rspec`                          | `bundle add rspec_junit_formatter --group test`             |

- Playwright chạy cạnh vitest hay jest thì mặc định mỗi bên lấy cả file của bên kia: đặt `testDir: "e2e"` trong playwright.config và loại `e2e/**` trong config của vitest hay jest (`verid cook` nhắc điều này khi thấy cả hai).
- Rust và CMake không có cờ ghi báo cáo: hãy đặt `test_cmd`. Không có runner nào thì `verid taste` từ chối (`VERID_BURNT_RUN_NO_RUNNER`), và cũng từ chối khi runner đã từng chạy giờ không còn (`VERID_BURNT_RUN_RUNNER_GONE`), cho tới khi chạy lại `verid cook`.

## Giới hạn

Hook không phải sandbox của hệ điều hành: verid bịt các lối tắt hay gặp, không bịt được mọi đường mà một agent cố tình tìm.

**Codex**

- Codex fail-open khi hook crash, timeout hay xuất sai định dạng; việc fail-closed bên trong verid không ngăn được quyết định đó của host.
- Codex bỏ qua hook chưa tin cậy; phải xem và tin cậy project cùng từng hook, và doctor không ép được host thực thi.
- Kích hoạt skill của Codex không có hook chung; `allowed_skills` chỉ là chỉ dẫn ở đó, kể cả skill fork.
- Thông điệp spawn Codex là dữ liệu mờ trong hook đã ghi, nên verid không kiểm chứng được reviewer chỉ nhận AC, đường dẫn design và diff.
- Model/effort riêng của reviewer chưa được chứng minh trên host cho tới khi controller xác nhận bằng live check.
- Việc tìm `verid_reviewer` từ config cấp người dùng chưa được chứng minh trên host cho tới khi controller xác nhận bằng live check.
- Input tiếp tục vào shell tương tác có thể không qua hook; tiến trình được cho phép có thể nhận input sau đó mà verid không xét.
- Đích ghi PowerShell được phân tích theo heuristic; script, đường dẫn ghép lúc chạy và lần ghi runtime có thể lọt.
- Codex không gửi `workdir` của lệnh Bash cho hook, nên đích Bash và PowerShell tương đối được xét theo thư mục session; lệnh chạy ở `workdir` khác, hay đổi thư mục trước (`cd`, `Set-Location`), có thể ghi vào đường dẫn khác với đường dẫn verid đã xét.
- Bước kiểm patch qua shell chỉ khớp tên trơn của chương trình patch; tên bị escape hay ghép lúc chạy (``apply`_patch``, `& $program`) vẫn có thể chạy shim patch của Codex.
- SubagentStop dùng dạng JSON giữ Stop, nhưng host phản ứng thế nào với lần giữ SubagentStop vẫn chưa được thử.
- Lần gọi của child Codex không có danh tính được coi là luồng chính; nó ghi được test và code qua cổng TDD.
- Codex ở đây chưa có kênh ngoại lệ xác thực người đang ngồi; `/verid tip` và `/verid confirm` không tạo được override.
- Khi chuyển `CODEX_HOME`, việc đọc `sessions/`, `history.jsonl` và `sqlite/` của nó bị chặn, nhưng các database trạng thái khác ở gốc thư mục đó thì không.
- Không có override trên Codex nên một luật Bash chặn nhầm thì chặn luôn (như `grep codex` trùng luật Codex lồng, hay `grep apply_patch` trùng luật patch qua shell); hãy chạy lệnh đó trong terminal của bạn.
- Codex không có tool Write/Edit trực tiếp và verid không mô phỏng patch, nên khi còn block verid, agent không sửa được `AGENTS.md` hay `CLAUDE.md`; bạn tự sửa.
- Bước chặn CLI của developer trên Codex dùng marker môi trường nội bộ nhưng chưa chứng minh được độ phủ trên mọi host đã cài; khi thiếu marker nhận diện được, lần gọi developer nhận diện được dựa vào luật hook.

**Plugin quy trình**

- Code plugin có toàn quyền của bạn: nó có thể sửa trực tiếp file, state hay hook, và nạp code project hoặc công cụ ngoài thư mục được bảo vệ. Hãy xem nguồn và dependency; verid không sandbox chúng.
- Bash vẫn có thể sửa file plugin trên đĩa qua các kẽ hở bên dưới; verid từ chối chạy code hay bản đăng ký plugin đã đổi cho tới khi developer duyệt lại bằng `verid plugin add` hoặc xác nhận khôi phục qua cook/upgrade. Script, đường dẫn ghép lúc chạy, tool ghi không nhận diện được và tiến trình bên ngoài vẫn tới được file cùng dữ liệu plugin. Bash nhắc `.verid/plugins`, `plugins.json` hoặc `plugin-data` bị từ chối thận trọng, kể cả đọc và tên không liên quan chứa các chuỗi con đó; hãy dùng Read hay Glob. Không override được các lần từ chối này. Lệnh workspace như `git -C .verid commit` và đường dẫn `plugins/` thông thường của ứng dụng được phép.
- Hard link có sẵn có thể đưa file được bảo vệ ra một tên khác; tiến trình khác cũng có thể thay đường dẫn đã kiểm trước khi sao chép hay thực thi. Hook không ngăn được race của hệ thống file.
- Khôi phục đối chiếu phiên bản tự khai của nguồn local rồi ghi bản duyệt nội dung mới; nguồn đó có thể đổi giữa các lần cài. Commit git hay phiên bản npm không chứng minh nguồn đáng tin, và dependency npm không được khoá qua các lần cài lại. Khi tải, verid dùng `npm install --ignore-scripts --no-bin-links`; npm cũng bỏ qua `prepare` của dependency git, nên package cần sinh file có thể không hoạt động.
- Sự kiện là quan sát, không phải hàng đợi: crash giữa lưu quyết định và gửi có thể làm mất sự kiện, và sự kiện fail hay timeout không được thử lại. Chuyển trạng thái auto được thấy ở Stop/SubagentStop; các module đã đóng trước đó có thể được báo trong lần quan sát đầu. Plugin phía sau có thể hết ngân sách thời gian trước khi chạy. Timeout dừng cả cây tiến trình; tiến trình con thoát khỏi cây hoặc không thể bị dừng do quyền của hệ điều hành vẫn có thể còn chạy.
- Dữ liệu plugin có thể chứa thông tin agent đọc được nếu rule file bí mật hiện có không khớp. Plugin nên giữ thông tin xác thực ngoài dữ liệu commit. Audit không ghi được lỗi khi chính nơi lưu nó không dùng được; cảnh báo cũng nói điều đó.

**Bash và các tool khác**

- Bash được so như chuỗi: biến, `$(...)`, `$'...'`, glob, script, `cd` rồi ghi theo đường dẫn tương đối, `git checkout`/`restore`/`apply`, `prettier --write` và đường dẫn ghép lúc chạy đều lọt. verid cố ý không làm allowlist cho Bash.
- Chuẩn hoá dấu phân cách của Bash có thể bỏ sót dấu phân cách lặp hoặc `/./` sau ký tự cú pháp shell trong một thành phần đường dẫn được đặt trong dấu nháy, như `cc(parent)//projects` dưới thư mục config được đổi vị trí.
- Cũng cách so đó chặn nhầm vài lệnh vô hại (`jq '.key'`, commit message có chữ `secret`, `other-verid upgrade`, `npx @vue/cli upgrade`, `npx expo-cli upgrade`); `/verid tip` cho qua các rule override được. Lệnh developer nhận diện được sẽ được so theo ranh giới từ, kể cả `verid@<version>`, tên npm có scope, tiền tố Windows `@`, `,`, `=` và entry point `cli` / `cli.js` đứng riêng sau `cd` hay khi xoá môi trường. Dấu `--` tuỳ chọn trước lệnh con cũng được so, kể cả `npm exec verid -- plugin`, `npm x -y verid -- cook`, `npx verid -- plugin` và `pnpm exec verid -- plugin`. Tên lệnh ghép lúc chạy và script bọc vẫn có kẽ hở nêu bên dưới; lệnh plugin không override được.
- Trên Claude Code, shell khác chỉ được nhận ra qua tên `PowerShell` hoặc khoá `command` ở cấp ngoài cùng: lệnh trong mảng, lồng sâu hơn, hay dưới `cmd`/`script` thì lọt; tool có `command` không liên quan thì bị chặn nhầm. Codex từ chối tool lạ và dạng shell động không hỗ trợ.
- Tool MCP được xét theo các khoá dạng đường dẫn và theo tên nói rằng nó ghi: khoá khác và tool ghi mà không nói ra thì lọt; đường dẫn ở nơi khác có thể bị chặn nhầm.
- Grep và Glob quét cả thư mục có thể đọc được file bí mật bên trong; chỉ chính file bí mật bị chặn.
- Hậu tố stream NTFS trên Windows được bỏ ở mọi thành phần đường dẫn trước khi xét chính sách, kể cả đích mới. Symlink và junction chỉ được resolve cho phần đường dẫn đã tồn tại, nên tên ngắn 8.3 của Windows cho file mới vẫn có thể lọt.
- Share quản trị ổ đĩa Windows qua UNC trên mọi host được xét như ổ đĩa cục bộ, kể cả đường dẫn qua ổ ánh xạ có realpath trả về share đó. Các share khác, ổ mạng ánh xạ tới share khác và bí danh `subst` không được đổi; đường dẫn tương đương có thể vượt bảo vệ so khớp tiền tố đường dẫn cục bộ. Bash không resolve ký tự ổ ánh xạ khi so khớp nhắc tới đường dẫn.

**Bằng chứng và vòng TDD**

- Workspace dùng chung một vòng: test fail trong repo này có thể mở code production ở repo khác. verid không kiểm phụ thuộc giữa repo, tính tương thích API hay module phải sửa repo nào.
- Đường dẫn ngoài mọi repo đã liệt kê giữ luật hiện tại: chính sách và giới hạn người ghi vẫn áp dụng, glob TDD thì không. File ở gốc workspace và repo không liệt kê nằm ngoài bước kiểm git của auto; `.verid` được tính.
- Code test chạy với toàn quyền trong `verid taste` và có thể ghi đè báo cáo; sha256 trong audit chỉ giúp phát hiện về sau, và hash chain phát hiện được log bị sửa nhưng không ngăn được.
- Test chỉ bị đóng băng ở COOKING: ở RAW và PLATED, nới một test trong khi thêm một test khác fail vẫn lọt.
- verid không biết code có vượt quá những gì test đòi hỏi không; PLATED vẫn cho thêm hành vi mới trong cùng một cuộc hội thoại.
- Cấu hình runner nằm ngoài `test_globs`, hay một file build, có thể bỏ một test đang fail ra khỏi lần chạy.
- Lúc dừng, verid chỉ thấy những lần ghi mà hook đã xét, và một lần ghi được tính ngay trước hộp thoại xin quyền, kể cả khi developer từ chối.
- Chỉ lỗi có type gọi tên một lỗi (`…Error`, `…Exception`) mới là crash; mọi dạng khác, như panic của Go hay exception `calc.NotReady`, là assertion, nên vẫn là RED.
- Bước stub không phân biệt được stub với bản cài đặt đầy đủ; test cố tình crash cũng mở được nó, và code làm test pass luôn thì vẫn ở lại.
- Mỗi lần một hành vi chỉ là cảnh báo.

**Baseline của remix**

- Baseline tính theo tên test: test bị đổi tên là lỗi mới, còn test mới trùng tên với một test baseline thì bị che khi đang đỏ.
- File test không load được là một test mang tên file; với jest-junit hay test pytest trong class, nó có thể nằm lại trong baseline và che lỗi load về sau.
- `verid stock` ghi lại mọi thứ đang đỏ lúc nó chạy: hãy chạy nó trước khi agent bắt đầu.
- Baseline, các module đã duyệt và các bản review nằm trong `.verid/.state/` của một máy: người clone project chạy `verid stock` hoặc `verid order` trên máy của họ.

**Plan và module**

- Ngày và việc gán iteration không đổi thứ tự module. Khi bật iterations, metadata sai ở dòng không rỗng đầu tiên dưới tiêu đề module làm module đó không duyệt được và giữ toàn bộ drive auto như mọi lỗi plan; sửa dòng này làm bản duyệt mất hiệu lực như mọi chỉnh sửa khác. Hook không ép lịch, việc gán iteration hay công việc có vừa thời lượng hay không.
- Một AC được tính là đã phủ khi mã của nó nằm trong id của một test pass, gồm cả đường dẫn file: test `AC-1` không assert gì vẫn được tính, và mọi test trong `AC-1-login.test.ts` cũng vậy.
- Mã AC phải khớp chính xác: `AC-01` không phải `AC-1`.
- Bản duyệt bao các byte, không bao ý nghĩa: mọi lần sửa phần của module hay `.verid/design.md` (một dấu cách, BOM, dòng CRLF), hoặc plan không còn đọc được, đều khoá code production cho tới lần `verid order` tiếp theo.
- Ở drive human, các lần Stop giữ agent vì một module (AC chưa phủ, rồi đánh giá) dùng chung một lần mỗi cuộc hội thoại, và verid chỉ nhớ cuộc hội thoại gần nhất.
- Gate plan, cũng như khoá RAW, chỉ xét `source_globs`.
- Khoá xét theo đường dẫn, không theo nội dung: logic trong file được bỏ qua (`setup.py`, `build.gradle`, JSON, HTML) thì tự do, `FooTest.java` nằm ngoài `src/test/` là code, và test viết chung file với code (Rust) không tách ra được.
- `verid serve` đòi một review ghi sau lần sửa cuối nhưng không chấm nó: developer là người đọc. Luồng chính tự viết prompt cho reviewer, nên verid biết là một reviewer đã chạy, chứ không biết nó xem gì hay xem kỹ tới đâu.
- Mỗi lúc chỉ một module và một vòng TDD được mở, và ranh giới module không được đối chiếu với code: hành vi của module khác vẫn lọt.
- verid không biết ai đã trả lời câu hỏi: `verid order` là lúc ký xác nhận; câu trả lời trong phần mở đầu của plan hay trong `.verid/research.md` thì không cần.
- `.verid/research.md` chỉ được xét là có tồn tại, không xét ai viết; chia module chỉ là lời nhắc.
- Khi mọi module đã đóng, code production bị khoá cho tới khi một module mới được duyệt; `verid garnish` không mở được.

**Vai trò và agent**

- Hook không kiểm chứng được agent soạn tài liệu đã trình bản đề xuất, chuyển câu hỏi kèm lựa chọn, nhận câu trả lời của developer, hay thống nhất phạm vi, ranh giới và DAG phụ thuộc trước khi ghi.
- Luồng chính và agent khác vẫn ghi được research, design và plan: gọi agent soạn tài liệu đã ánh xạ là chỉ dẫn của skill.
- Đường dẫn trong `e2e_globs` không chứng minh test chạy sản phẩm từ đầu tới cuối hay qa lấy selector từ code UI thật.
- Vai trò xét theo `agent_type` trong payload: nếu Claude Code đổi tên hoặc bỏ nó, subagent trông như luồng chính, nên khi tách mọi lần ghi code hay test bị chặn, không có reviewer thì `verid serve` từ chối, và auto fail-closed.
- Trên Claude Code, allowlist skill bịt đường `context: fork` với skill ngoài danh sách. Skill được phép vẫn có thể fork dưới loại agent khác, được verid xét là `other`: khi tách, nó không ghi được code hay test, nhưng ghi được file tự do và chạy Bash.
- Tên trong `roles` phải khớp chính xác: agent bị plugin của nó đổi tên thì mất vai trò, theo kiểu fail-closed (ghi bị chặn, `verid serve` từ chối).
- Plugin verid của Claude Code cài riêng với package npm: khi chưa cài, `roles` trỏ tới các agent không có (ghi bị chặn, `verid serve` từ chối), và cập nhật một bên mà quên bên kia thì hai bản lệch nhau.
- Khi tách, tester vẫn có thể làm yếu một test ở RAW hay PLATED: việc tách chỉ ngăn coder.
- Trên Claude Code, tester và coder có Bash, và chỉ hook giữ mỗi agent trong phần của nó. Việc tách bật mặc định, nên luồng chính không còn tự viết code hay test.
- Agent của plugin khác, hay của ClaudeKit, được ánh xạ trong `roles` không biết verid: chỉ thông báo từ chối của hook chỉ đường cho chúng. Agent của chính verid thì biết.
- Tên agent không có namespace (`general-purpose`, hay agent ở `~/.claude/agents/` như của ClaudeKit) bị thay bởi một `.claude/agents/<tên>.md` có sẵn trong repo vừa clone; tên `verid:*` thì không. Hook chặn agent tạo file đó, nhưng không chặn file đã có sẵn. Skill trong `.claude/skills/` đã có trên đĩa (từ repo vừa clone hay kit khác) mà `name` dùng namespace được phép cũng qua allowlist, kể cả trong thư mục lồng nhau.
- Skill của verid, superpowers và andrej-karpathy-skills là lời nhắc: hook không biết agent có dùng hay làm theo chúng hay không.

**Drive auto**

- Hook không ép `feat/<module>`, một nhánh mỗi module hay nhánh chứa commit; nó vẫn chỉ kiểm tree của project sạch.
- Verdict do chính reviewer viết: verid chỉ đọc dòng `Verdict:`, không biết reviewer đọc kỹ tới đâu, và không có người nào đọc review trước khi module đóng.
- Plan do agent viết và reviewer duyệt; không người nào ký plan.
- Báo cáo được xếp là review plan hay review module theo chỗ drive đang đứng, không theo việc reviewer được nhờ review cái gì.
- Agent gọi reviewer tự viết lời nhờ, nên verid không biết reviewer được cho xem gì; một reviewer còn chạy nền trong lúc code đổi vẫn ghi báo cáo như thể nó đến sau lần sửa cuối.
- Lượt coder đếm theo tên AC của test đỏ lúc coder dừng; test đỏ không mang tên AC thì không được đếm.
- Git kiểm tree sạch ở các thư mục của layout, không kiểm nội dung commit, module sở hữu hay các commit có đồng bộ giữa repo không.
- Git lỗi trong repo (dubious ownership, index hay config hỏng), hoặc repo mất git sau khi đã ký có git, đều tính là chưa commit. Option C áp dụng riêng từng repo: thư mục ký khi chưa có git bỏ qua bước kiểm đó cho tới khi có git; muốn bỏ git thì phải `verid order` lại.
- Thứ mà chính git ẩn đi thì không tính là chưa commit: dòng trong `.gitignore`, `.git/info/exclude` hay file ignore toàn cục (`core.excludesFile`), file đánh dấu `assume-unchanged` hay `skip-worktree`, submodule đặt `ignore`.
- Agent không gọi tên được `.claude/settings.local.json` hay `.codex/hooks.json` trong Bash, nên thường commit bằng `git add -A`; bước kiểm git bỏ qua cả hai, Claude Code thường thêm file đầu vào gitignore toàn cục, và thiếu dòng gitignore thì file nào cũng có thể bị commit.
- Claude Code không chạy Stop khi bấm Esc: ngắt không bị tính là không tiến triển, nhưng agent cũng không bị giữ lại.
- `.verid/blocked.md` là lời agent tự khai: agent có thể khai kẹt giả (nhưng khi đó nó dừng hẳn).
- Lời khai kẹt chỉ được chốt khi một hook thấy `.verid/blocked.md` (ở một lần Stop hay một lần gọi tool có ghi file): một script xoá file trước mà hook không đọc ra là có ghi, như `node cleanup.js`, thì không để lại lời khai kẹt nào.
- "Không tiến triển" chỉ dựa trên những gì hook thấy: Bash ghi file mà hook không nhận ra thì không tính là tiến triển.
- Bộ đếm không tiến triển chỉ so mỗi lần Stop với lần ngay trước: kết quả cứ đổi mà không thật sự tiến (một test chập chờn, một byte của `.verid/plan.md` bật tắt qua lại, commit rỗng) làm nó về 0, nên vòng lặp đó không bị chặn.
- Khi đang kẹt, một lần ghi code cần hai `/verid tip` (khoá kẹt, rồi không có module mở), như mọi lần gọi vướng hai rule.
- Auto giữ mọi lần Stop bất kể `stop_hook_active` nói gì: nếu Claude Code đổi nghĩa của cờ đó, agent có thể dừng giữa chừng.

**Runner**

- Doctor nhận runner từ file build hoặc `test_cmd` riêng; nó không chạy test hay kiểm tra executable của runner đã cài chưa.
- File build không bị khoá: agent có thể thêm một runner, hay làm một runner bỏ qua test.
- File build nằm sâu hơn một cấp thư mục (`packages/a/b/pom.xml`) không được tìm thấy; hãy đặt `test_cmd`.
- Xoá file build sẽ bị chặn nhờ runner đã ghi nhớ, nhưng `verid cook` bỏ runner đó mà không hỏi.
- Báo cáo của Maven và Gradle được đọc từ thư mục của project, vốn không được bảo vệ: code test, một plugin hay một tiến trình còn chạy nền có thể ghi báo cáo.
- Chỉ vitest và Maven đã được chạy thật, còn báo cáo JUnit của Playwright được kiểm bằng tay; các runner còn lại theo tài liệu của tool.
- Mọi test Playwright báo đều là end-to-end; các runner khác xét theo đường dẫn, nên unit test đặt trong `e2e/` cũng được tính, còn test end-to-end ngoài `e2e_globs` thì không.
- Có `test_cmd` thì verid không biết runner: test Playwright chỉ được tính khi file khớp `e2e_globs`, mà Playwright đặt tên file tính từ `testDir` của nó.
- pytest, Java, .NET và Go báo tên class, không báo file: test end-to-end của chúng phải nằm trong thư mục hay package tên `e2e`.
- jest báo tên khối describe nếu chưa đặt `JEST_JUNIT_CLASSNAME={filepath}`, còn integration test của Maven (failsafe) không chạy trong `mvn test`: hãy đặt `test_cmd`.
- `verid taste` chạy cả test end-to-end mỗi lần, nên vòng TDD chậm theo chúng.
- jest-junit cần `JEST_JUNIT_REPORT_TEST_SUITE_ERRORS=true`, nếu không file test không load được sẽ không có trong báo cáo.
- Với ngôn ngữ biên dịch, test gọi class chưa có thì không có báo cáo, nên stub đầu tiên cần một lần override; verid nói rõ điều đó với Maven và Gradle, và không bao giờ đọc log build.
- `timeout_sec` dài hơn mốc 2 phút của Bash tool thì Claude Code cắt `verid taste` trước, và test có thể còn chạy.
- Timeout từng repo chạy nối tiếp, nên tổng thời gian có thể vượt timeout của Bash dù mỗi repo đều chạy trong giới hạn của mình.
- Glob không phân biệt hoa thường trên mọi hệ điều hành.

**Tự bảo vệ và override**

- Lần gọi Write/Edit/MultiEdit trực tiếp được sửa nội dung người dùng quanh block verid giữ nguyên. Lần ghi Bash, MCP và `apply_patch` của Codex nhận diện được tới file chỉ dẫn bị chặn vì không kiểm chứng được nội dung sau khi ghi; hãy dùng Read để đọc. Script, đường dẫn ghép lúc chạy, tool ghi không nhận diện được và race hệ thống file vẫn có các kẽ hở nêu ở đây. `verid upgrade` khôi phục block thiếu hoặc đã sửa, giữ nội dung người dùng.

- Agent vẫn thêm được chỉ dẫn ngoài block hoặc trong `CLAUDE.local.md`, `.claude/CLAUDE.md` hay `.claude/rules/`; block là chỉ dẫn, chỉ hook mới ép buộc rule.
- Doctor kiểm tra bản ghi cài plugin phiên bản 2 và thư mục trong `CLAUDE_CONFIG_DIR` (mặc định `~/.claude`); nó không chứng minh được plugin đang bật hay skill load được.
- `dist/` và thư mục `plugin/` của verid (skill cùng template reviewer Codex) được bảo vệ; sửa `i18n/*.json` đổi được thông báo, không đổi được quyết định.
- Lần ghi nhận diện được tới định nghĩa agent, plugin, skill và command trong `.claude/` của project hay home và `CLAUDE_CONFIG_DIR` bị chặn; xoá thư mục cha mà không nêu tên con, script, đường dẫn ghép lúc chạy, tool ghi không nhận diện được, hard link có sẵn và race hệ thống file vẫn có kẽ hở. Hook trong frontmatter của skill, command hay subagent và plugin đã cài chạy mà không bị kiểm tra, có thể sửa input của tool sau khi verid đã xét.
- Bash chỉ xét `.claude/skills/` và `.claude/commands/` ở đích ghi phân tích được, nên vẫn đọc hay chạy script của skill; các lần ghi không phân tích được như `cd <skill-or-command-dir>; printf x > file`, script và đường dẫn ghép lúc chạy vẫn lọt. Rule chặn nhắc tới `.claude/commands/verid/` có sẵn vẫn áp dụng.
- Bash nhắc tới `.claude/agents`, `.claude/plugins` hay `.claude/commands/verid` bị chặn kể cả khi chỉ đọc (hãy dùng Read hoặc Glob); developer sửa các định nghĩa đó.
- Bash nhắc tới bất kỳ file nào tên `manifest.yaml` bị chặn kể cả khi chỉ đọc, như `cat .verid/manifest.yaml`: hãy dùng Read, hoặc `/verid tip`.
- Xoá `.verid` làm mọi lần gọi tool bị chặn.
- Lệnh của developer và `CLAUDECODE` được chặn khỏi Bash của agent chỉ theo tên: qua script, biến hay chuỗi ghép lúc chạy, agent có thể tự cập nhật cài đặt bằng upgrade, tự ghi baseline, tự duyệt hay tự đóng module của mình, hoặc ở auto tự ký design hay chạy tiếp một drive đang kẹt.
- Bash của agent thừa hưởng `CLAUDE_CODE_SESSION_ATTENDED`: lệnh nhắc tới hook của verid bị chặn, nhưng qua bản copy của hook, một script hay đường dẫn ghép lúc chạy, agent có thể tự cấp override cho mình.
- Công cụ giả terminal như `node-pty` có thể mở một phiên lồng mà Claude Code coi là có người ngồi.
- Mã xác nhận vẫn nằm trong transcript trên đĩa, nơi agent bị chặn đọc.
- Override dựa vào biến nội bộ `CLAUDE_CODE_SESSION_ATTENDED` của Claude Code: nếu biến này bị đổi tên thì override ngừng hoạt động và mọi thứ vẫn bị chặn.
- Override chỉ gỡ đúng rule nó nêu; các rule khác, luật vai trò và cổng TDD vẫn xét lần gọi đó, và rule nào vẫn chặn thì cần `/verid tip` riêng.
- Trên Claude Code, lần gọi PowerShell không hỗ trợ được override thì không có phân tích đích; tool MCP có `command` chỉ bị xét trên đường dẫn input nêu. Codex thêm phân tích đích PowerShell theo heuristic, với các kẽ hở đã nêu.
- Màn hình cài đặt cần một terminal thật, và được kiểm thử bằng một terminal giả lập.
- Dòng trạng thái, đường dẫn file và chi tiết lỗi phân tích vẫn bằng tiếng Anh; payload của hook không phải JSON thì nhận cả hai thứ tiếng.
- Khi tải cao, một lần gọi bị chặn có thể nhận `VERID_BURNT_LOCK_TIMEOUT`: vẫn bị chặn, nhưng không được đếm.

## Phát triển

```bash
npm test             # build, rồi chạy unit test và end-to-end test
npm run test:full    # như trên, thêm test của installer
npm run typecheck
npm run format
```

Không có CI: `test/e2e/hook.e2e.test.ts` chạy lại payload ghi từ Windows, nên hãy chạy `npm test` trên Windows trước mỗi commit, và `npm run test:full` khi đổi `install.ps1`, `install.sh` hay test của chúng.

## Ghi nhận

verid đứng trên vai hai project:

- **[superpowers](https://github.com/obra/superpowers)** của Jesse Vincent: vòng của verid là vòng RED-GREEN-REFACTOR của skill `test-driven-development`, và "evidence before claims" lấy từ `verification-before-completion`. verid thêm hook để ép chúng.
- **[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)** của forrestchang: nghĩ trước khi code, ưu tiên đơn giản, sửa đúng chỗ, làm theo mục tiêu kiểm chứng được.

verid là project độc lập, không liên kết với hai project trên.

## Giấy phép

MIT, xem [LICENSE](./LICENSE).
