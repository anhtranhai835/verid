```
 ██╗   ██╗ ███████╗ ██████╗  ██╗ ██████╗
 ██║   ██║ ██╔════╝ ██╔══██╗ ██║ ██╔══██╗
 ██║   ██║ █████╗   ██████╔╝ ██║ ██║  ██║
 ╚██╗ ██╔╝ ██╔══╝   ██╔══██╗ ██║ ██║  ██║
  ╚████╔╝  ███████╗ ██║  ██║ ██║ ██████╔╝
   ╚═══╝   ╚══════╝ ╚═╝  ╚═╝ ╚═╝ ╚═════╝
     hook-enforced TDD for Claude Code · RAW → COOKING → PLATED
```

# verid

[English](README.md) · **Tiếng Việt**

> Agent làm việc. verid kiểm chứng. Developer duyệt.

## Vì sao

Coding agent khi vội thường bỏ qua test: viết code trước, hoặc nới test cho tới khi nó xanh. Prompt chỉ yêu cầu được TDD; hook thì từ chối được lần ghi. verid đặt một hook fail-closed trước mọi lần gọi tool của Claude Code, và giữ agent đi đúng vòng RED → GREEN → REFACTOR của skill `test-driven-development` trong [superpowers](https://github.com/obra/superpowers), dưới tên RAW → COOKING → PLATED. Chỉ developer mới mở được ngoại lệ, và audit log có hash chain ghi lại điều đó. Trong project của bạn, verid chỉ thêm `.verid/`, `.claude/commands/verid/` và file riêng của từng máy `.claude/settings.local.json`.

## Yêu cầu

- Node.js 22 trở lên, và [Claude Code](https://claude.com/claude-code).
- Plugin superpowers, nơi có các skill mà verid chỉ agent tới.
- Plugin verid: các agent tester, coder và reviewer mà `verid cook` ánh xạ vào các vai trò, cùng một skill cho mỗi bước. Agent nào khác cũng nhận được vai trò qua `roles`.

```bash
claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace
claude plugin marketplace add anhtranhai835/verid
claude plugin install verid@verid
```

## Cài đặt

```bash
npm install -g @anhtranhai835/verid
```

Từ bản clone: `npm ci`, `npm run build`, `npm link` (hoặc `bun install --frozen-lockfile`, `bun run build`, `bun link`). Hook trỏ vào `dist/` của bản đã cài, nên hãy chạy lại `verid cook` trong mỗi project sau khi nâng cấp, chuyển bản clone sang chỗ khác, hoặc đổi giữa bản npm và bản clone.

## Bắt đầu nhanh

Trong terminal của bạn, ở project cần bảo vệ:

```bash
verid cook     # chọn ngôn ngữ, mode và, ở prep và recipe, drive
verid stock    # chỉ remix: ghi lại các test đã đỏ từ trước
```

Rồi mở Claude Code và nói bạn muốn làm gì. Mỗi thông báo của verid đều nêu lệnh tiếp theo; `verid menu` cho biết project đang ở đâu.

Commit `.verid/manifest.yaml`, `.verid/.gitignore`, `.claude/commands/verid/` và, ở prep và recipe, `.verid/research.md`, `.verid/design.md` cùng `.verid/plan.md`. Đừng commit `.claude/settings.local.json`: file này ghi verid của máy bạn. Người trong team chạy `verid cook` một lần sau khi clone.

## Mode

| Mode     | Bắt đầu từ                | verid thêm                                                                                                                                                                                                      |
| :------- | :------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prep`   | một ý tưởng, chưa có code | nghiên cứu trong `.verid/research.md`, thiết kế trong `.verid/design.md`, rồi các module trong `.verid/plan.md`, mỗi module được duyệt, review rồi đóng, và cuối cùng là module `product` gồm các AC end-to-end |
| `recipe` | một bản đặc tả            | các bước như trên, với các module lấy từ đặc tả                                                                                                                                                                 |
| `remix`  | code và test có sẵn       | baseline của các test đã đỏ từ trước verid                                                                                                                                                                      |

## Drive: human hay auto

Ở prep và recipe, trường `drive` trong manifest nói ai đưa project đi từ module này sang module khác; `verid cook` hỏi điều này sau khi chọn mode.

| Drive              | Ai đưa project đi                                                                                                                    |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `human` (mặc định) | developer: `verid order <module>` mở từng module, `verid serve <module>` đóng nó                                                     |
| `auto`             | agent: nó lập plan, làm và review mọi module, `product` cuối cùng, và chỉ dừng khi kẹt. Cần cả reviewer, tester, coder trong `roles` |

Drive auto:

1. **Hỏi.** Agent hỏi các câu research và design rồi ghi `.verid/research.md` và `.verid/design.md`. Khi chưa ký, code production bị khoá và drive không giữ agent (các lần giữ thông thường vì test đỏ, stub hay thay đổi chưa chạy vẫn áp dụng).
2. **Ký.** Developer đọc cả hai và chạy `verid order` (không kèm module) trong terminal của mình; verid ghi sha256 của chúng. Trừ khi drive bị kẹt, đó là lệnh duy nhất developer phải gõ.
3. **Plan.** Agent viết `.verid/plan.md`, kết thúc bằng `product`, và reviewer review nó so với design. Bản review kết thúc bằng `Verdict: pass` hoặc `Verdict: fail`; thiếu dòng này tính là fail. Code production vẫn bị khoá cho tới khi plan pass.
4. **Làm.** verid mở module đầu tiên chưa đóng, theo thứ tự trong plan. Tester và coder làm từng AC theo kiểu test trước, agent commit, reviewer review module.
5. **Đóng.** verid đóng module khi mọi AC có test pass, lần chạy cuối pass và không có thay đổi nào sau nó, review sau lần sửa cuối kết luận pass, và git tree sạch tính từ thư mục project trở xuống (file chưa track cũng tính, `.claude/settings.local.json` thì không). Module kế tiếp mở; drive xong khi `product` đóng sau cùng, và một module đóng sau `product` sẽ mở lại `product`.

Stop giữ agent mọi lần, nói bước kế tiếp, cho tới khi drive xong hoặc kẹt. `verid menu` và thông báo đầu phiên cho thấy drive (đã ký chưa, plan đã duyệt chưa, các module, bộ đếm n/3, bước kế tiếp hoặc vì sao kẹt); `verid peek` cho thấy vòng TDD và bước kế tiếp.

**Giới hạn.** Mọi vòng lặp dừng ở 3: review plan fail, lượt coder cho mỗi AC (một lượt kết thúc khi coder dừng mà còn test đỏ mang tên AC), review module fail, và các lần Stop giữ liên tiếp mà không tiến triển (test, plan, commit và bộ đếm không đổi). Bộ đếm về 0 khi vòng lặp của nó pass; riêng bộ đếm không tiến triển về 0 khi kết quả đổi.

**Kẹt** khi `.verid/blocked.md` có chữ (agent ghi khi chỉ developer trả lời được, hoặc developer ghi để tạm dừng), đạt một giới hạn, `.verid/research.md` hoặc `.verid/design.md` khác bản đã ký, hoặc phần plan của một module đã đóng bị sửa hay bị xoá. Lần đầu một hook thấy `.verid/blocked.md` (ở bất kỳ lần Stop nào, hay lần gọi tool nào có ghi file, kể cả lệnh Bash `rm` chính file đó), verid chốt lời khai kẹt vào `.verid/.state/`, nên xoá file cũng không gỡ được; bộ đếm đạt giới hạn cũng giữ nguyên cho tới `verid order`. Hai nguyên nhân sau cùng được đọc lại từ chính các file, nên trả chúng về bản cũ là gỡ được. Khi kẹt, code production và test bị khoá (`VERID_BURNT_AUTO_STUCK`), và Stop cho agent dừng rồi báo developer lý do, như khi xong.

**Chạy tiếp** bằng `verid order`: nó ký lại, đặt lại các bộ đếm, xoá `.verid/blocked.md` và bỏ bản review của module đang mở. Plan chỉ giữ nguyên là đã duyệt khi research và design không đổi; module đã đóng mà phần plan của nó bị sửa thì được mở lại, còn module plan đã bỏ thì bị quên đi.

**Từ chối.** Khi không có module nào đang mở, code production bị khoá (`VERID_BURNT_AUTO_NO_MODULE`). Ở auto, `verid order <module>` và `verid serve` từ chối (`VERID_BURNT_AUTO_ORDER_MODULE`, `VERID_BURNT_AUTO_SERVE`), và `verid order` từ chối khi còn thiếu research hay design (`VERID_BURNT_RESEARCH_MISSING`, `VERID_BURNT_DESIGN_MISSING`).

**Esc và đổi drive.** Bấm Esc để hỏi agent giữa chừng: Stop không chạy khi bị ngắt, và giữ agent lại sau khi nó trả lời. Muốn đổi drive, sửa `drive:` trong `.verid/manifest.yaml`. Module đã đóng vẫn là đã đóng; từ human sang auto cần ký và một lần review plan; từ auto sang human thì module đang mở cần `verid order <module>`.

## Các lệnh

| Lệnh                         | Ai chạy                      | Làm gì                                                                                                                                       |
| :--------------------------- | :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `verid cook`                 | developer                    | cài verid cho project và máy này; đề xuất mặc định mới cho manifest cũ                                                                       |
| `verid taste`                | agent                        | chạy test; chỉ những lần chạy này mới là bằng chứng                                                                                          |
| `verid peek`                 | ai cũng được                 | vòng TDD, bước tiếp theo, và vì sao lần chạy gần nhất không được tính                                                                        |
| `verid menu`                 | ai cũng được                 | nghiên cứu, các module và độ phủ AC, câu hỏi còn mở, bước tiếp theo                                                                          |
| `verid stock`                | developer                    | remix: ghi các test đang đỏ làm baseline                                                                                                     |
| `verid order [module]`       | developer                    | prep, recipe: duyệt một module của `.verid/plan.md`, ký cả `.verid/design.md`; auto: ký research và design, và chạy tiếp sau khi dừng        |
| `verid serve <module>`       | developer                    | prep, recipe, chỉ drive human: đóng module đang mở khi mọi AC đã pass và reviewer đã review nó sau lần sửa cuối; in đường dẫn của bản review |
| `verid garnish`              | developer                    | mở code production cho cuộc hội thoại chỉ để refactor                                                                                        |
| `/verid:tip <lý do>`         | developer, trong Claude Code | xin cho hành động vừa bị chặn đi qua, kèm một mã dùng một lần                                                                                |
| `/verid:confirm <mã>`        | developer, trong Claude Code | cho đúng hành động đó qua một lần                                                                                                            |
| `/verid:peek`, `/verid:menu` | developer, trong Claude Code | những gì `verid peek` và `verid menu` hiện, chỉ cho bạn xem                                                                                  |

`verid cook` nhận `--mode prep|recipe|remix`, `--drive human|auto`, `--lang vi|en`, `--test-cmd` (lệnh test của riêng bạn) và glob `--src`/`--tests` (lặp lại được), và tự hỏi khi chạy trong terminal mà không có cờ nào. Khi manifest đã có, `--mode`, `--drive`, `--test-cmd`, `--src` và `--tests` bị bỏ qua kèm một ghi chú: hãy sửa `.verid/manifest.yaml` bằng tay. Các lệnh của developer từ chối chạy bên trong Claude Code, và hook chặn chúng khỏi Bash của agent.

## Cách hoạt động

### Ba nguyên tắc

1. **Không có code production khi chưa có test fail.** Code production bị khoá khi vòng đang ở RAW, và ở prep và recipe khi chưa có module nào được duyệt. Khi đang có test fail, các test bị đóng băng.
2. **Bằng chứng trước khi tuyên bố xong.** Chỉ lần chạy `verid taste` có mã thoát khớp với báo cáo JUnit mới được tính. Ở drive human, agent không dừng được khi lần chạy gần nhất đang fail hoặc sau một thay đổi chưa lần chạy nào thấy; drive auto tự giữ mọi lần Stop.
3. **Chỉ developer mở được ngoại lệ.** `/verid tip` chỉ dùng được khi có người ngồi ở bàn phím, không bao giờ từ subagent hay `claude -p`. Mỗi ngoại lệ cho một hành động qua một rule, một lần: lệnh vướng hai rule thì cần hai lần.

### Vai trò

Claude Code đặt một `agent_type` vào mỗi lần gọi tool từ subagent; `roles` ánh xạ các agent type đó sang vai trò. Có cả tester lẫn coder thì việc được tách:

| Ai ghi                                 | Code production   | Test               | File khác (docs, config, `.verid/*.md`) |
| :------------------------------------- | :---------------- | :----------------- | :-------------------------------------- |
| reviewer                               | `ROLE_READ_ONLY`  | `ROLE_READ_ONLY`   | `ROLE_READ_ONLY`                        |
| khi tách: coder                        | theo cổng TDD     | `ROLE_TESTER_ONLY` | được                                    |
| khi tách: tester                       | `ROLE_CODER_ONLY` | theo cổng TDD      | được                                    |
| khi tách: luồng chính, agent khác      | `ROLE_CODER_ONLY` | `ROLE_TESTER_ONLY` | được                                    |
| khi không tách: mọi người trừ reviewer | theo cổng TDD     | theo cổng TDD      | được                                    |

- Lần gọi không có `agent_id` là của luồng chính, kể cả khi chạy `claude --agent X`. Luật vai trò xét trước cổng TDD: vai trò nói ai, vòng TDD nói lúc nào.
- Khi reviewer dừng lúc có module đang mở, verid ghi báo cáo cuối của nó vào `.verid/.state/reviews/`; một lần ghi code hay test sau đó, hoặc một lần `verid order` mới, làm bản review đó mất hiệu lực.
- Subagent đã ghi code hay test bị giữ lại một lần nếu dừng khi còn test fail, stub đang mở hoặc thay đổi chưa chạy; tester không bị giữ vì test fail hay stub.

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

| Rule                               | Override được | Phạm vi                                                                                                           |
| :--------------------------------- | :------------ | :---------------------------------------------------------------------------------------------------------------- |
| `VERID_BURNT_STATE_PROTECTED`      | không         | đọc hoặc ghi `.verid/.state/`                                                                                     |
| `VERID_BURNT_SECRET_PROTECTED`     | không         | file bí mật: `.env*` (trừ file mẫu), key, chứng chỉ, `.ssh/`, `.npmrc`…                                           |
| `VERID_BURNT_TRANSCRIPT_PROTECTED` | không         | transcript của Claude Code trong `~/.claude/projects/`                                                            |
| `VERID_BURNT_HOOK_PROTECTED`       | không         | ghi `.claude/settings*.json`, `.claude/agents/`, `.claude/plugins/`, `.claude/commands/verid/`, `dist/` của verid |
| `VERID_BURNT_MANIFEST_PROTECTED`   | có            | ghi `.verid/manifest.yaml`                                                                                        |
| `VERID_BURNT_BASH_NESTED_CLAUDE`   | có            | Bash mở một phiên `claude` lồng                                                                                   |
| `VERID_BURNT_BASH_DEVELOPER_ONLY`  | có            | Bash nhắc tới `CLAUDECODE` hay hook của verid, hoặc chạy lệnh của developer                                       |
| `VERID_BURNT_SHELL_UNSUPPORTED`    | có            | PowerShell, hay tool khác bất kỳ có input `command`                                                               |
| `VERID_BURNT_ROLE_READ_ONLY`       | có            | mọi lần ghi của reviewer đã ánh xạ                                                                                |
| `VERID_BURNT_ROLE_TESTER_ONLY`     | có            | khi tách: test do người khác ngoài tester ghi                                                                     |
| `VERID_BURNT_ROLE_CODER_ONLY`      | có            | khi tách: code production do người khác ngoài coder ghi                                                           |
| `VERID_BURNT_PLAN_NO_RESEARCH`     | có            | ghi `.verid/plan.md` khi chưa có `.verid/research.md`                                                             |
| `VERID_BURNT_PLAN_NO_DESIGN`       | có            | ghi `.verid/plan.md` khi chưa có `.verid/design.md`                                                               |
| `VERID_BURNT_PLAN_NOT_APPROVED`    | có            | code production khi không có module nào đang mở (prep, recipe)                                                    |
| `VERID_BURNT_AUTO_NO_MODULE`       | có            | auto: code production khi không có module nào đang mở                                                             |
| `VERID_BURNT_AUTO_STUCK`           | có            | auto: code production và test khi drive đang kẹt                                                                  |
| `VERID_BURNT_TDD_NO_FAILING_TEST`  | có            | code production khi vòng đang ở RAW                                                                               |
| `VERID_BURNT_TDD_TEST_FROZEN`      | có            | test khi vòng đang ở COOKING                                                                                      |

Các rule áp dụng cho tool file, Bash (đích ghi rõ ràng của nó được xét như một lần Write) và tool MCP. Mọi lỗi bất ngờ đều chặn lần gọi đó.

## manifest.yaml

```yaml
schemaVersion: 1
mode: remix # prep | recipe | remix
roles: # tuỳ chọn: agent type, đúng như Claude Code báo, cho từng vai trò
  reviewer: ["verid:reviewer"]
  tester: ["verid:tester"] # có cả tester lẫn coder thì việc được tách
  coder: ["verid:coder"]
drive: human # human | auto
repos:
  - path: .
    # test_cmd: make test JUNIT={junit}   # tuỳ chọn: không có thì verid tự tìm runner
    source_globs: ["**"] # code production
    test_globs: ["**/test/**", "**/*.test.*", …] # test và cấu hình runner
    ignore_globs: ["**/*.md", "**/*.json", …] # không bao giờ là code production
    e2e_globs: ["**/e2e/**", "**/*.e2e.*"] # test end-to-end
    timeout_sec: 100 # tuỳ chọn
```

- Chỉ developer sửa manifest; `verid cook` ghi các mặc định, trong đó mọi file đều là code, trừ test, tài liệu, dữ liệu, cấu hình, file build và thư mục của tool.
- Mỗi tên trong `roles` chỉ thuộc một vai trò, và đã có tester thì phải có coder. Không có `roles` thì không ai bị giữ theo vai trò, và `verid serve` từ chối vì thiếu reviewer. `drive: auto` mà không ở prep hay recipe hoặc thiếu một trong ba vai trò thì manifest bị từ chối.
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

**Bash và các tool khác**

- Bash được so như chuỗi: biến, `$(...)`, `$'...'`, glob, script, `cd` rồi ghi theo đường dẫn tương đối, `git checkout`/`restore`/`apply`, `prettier --write` và đường dẫn ghép lúc chạy đều lọt. verid cố ý không làm allowlist cho Bash.
- Cũng cách so đó chặn nhầm vài lệnh vô hại (`jq '.key'`, commit message có chữ `secret`); `/verid tip` cho chúng qua.
- Shell khác chỉ được nhận ra qua tên `PowerShell` hoặc khoá `command` ở cấp ngoài cùng: lệnh trong mảng, lồng sâu hơn, hay dưới `cmd`/`script` thì lọt; tool có `command` không liên quan thì bị chặn nhầm.
- Tool MCP được xét theo các khoá dạng đường dẫn và theo tên nói rằng nó ghi: khoá khác và tool ghi mà không nói ra thì lọt; đường dẫn ở nơi khác có thể bị chặn nhầm.
- Grep và Glob quét cả thư mục có thể đọc được file bí mật bên trong; chỉ chính file bí mật bị chặn.
- Symlink và junction chỉ được resolve cho phần đường dẫn đã tồn tại, nên tên ngắn 8.3 của Windows cho file mới có thể lọt.

**Bằng chứng và vòng TDD**

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

- Vai trò xét theo `agent_type` trong payload: nếu Claude Code đổi tên hoặc bỏ nó, subagent trông như luồng chính, nên khi tách mọi lần ghi code hay test bị chặn, không có reviewer thì `verid serve` từ chối, và auto fail-closed.
- Tên trong `roles` phải khớp chính xác: agent bị plugin của nó đổi tên thì mất vai trò, theo kiểu fail-closed (ghi bị chặn, `verid serve` từ chối).
- Plugin verid cài riêng với package npm: khi chưa cài, `roles` trỏ tới các agent không có (ghi bị chặn, `verid serve` từ chối), và cập nhật một bên mà quên bên kia thì hai bản lệch nhau.
- Khi tách, tester vẫn có thể làm yếu một test ở RAW hay PLATED: việc tách chỉ ngăn coder.
- Tester và coder có Bash, và chỉ hook giữ mỗi agent trong phần của nó. Việc tách bật mặc định, nên luồng chính không còn tự viết code hay test.
- Agent của plugin khác, hay của ClaudeKit, được ánh xạ trong `roles` không biết verid: chỉ thông báo từ chối của hook chỉ đường cho chúng. Agent của chính verid thì biết.
- Tên agent không có namespace (`general-purpose`, hay agent ở `~/.claude/agents/` như của ClaudeKit) bị thay bởi một `.claude/agents/<tên>.md` có sẵn trong repo vừa clone; tên `verid:*` thì không. Hook chặn agent tạo file đó, nhưng không chặn file đã có sẵn.
- Skill của verid và của superpowers là lời nhắc: hook không biết agent có dùng chúng hay không.

**Drive auto**

- Verdict do chính reviewer viết: verid chỉ đọc dòng `Verdict:`, không biết reviewer đọc kỹ tới đâu, và không có người nào đọc review trước khi module đóng.
- Plan do agent viết và reviewer duyệt; không người nào ký plan.
- Báo cáo được xếp là review plan hay review module theo chỗ drive đang đứng, không theo việc reviewer được nhờ review cái gì.
- Agent gọi reviewer tự viết lời nhờ, nên verid không biết reviewer được cho xem gì; một reviewer còn chạy nền trong lúc code đổi vẫn ghi báo cáo như thể nó đến sau lần sửa cuối.
- Lượt coder đếm theo tên AC của test đỏ lúc coder dừng; test đỏ không mang tên AC thì không được đếm.
- Git chỉ được kiểm là tree sạch, tính từ thư mục project trở xuống, không kiểm commit chứa gì hay thuộc module nào.
- Git lỗi trong một repo (dubious ownership, index hay config hỏng), hoặc repo mất hay hỏng sau khi đã ký trong git, đều tính là chưa commit, nên module chờ; bước kiểm chỉ bỏ qua khi project nằm ngoài git (hoặc git không có trong `PATH`) lúc ký, và muốn bỏ git thì phải `verid order` lại.
- Thứ mà chính git ẩn đi thì không tính là chưa commit: dòng trong `.gitignore`, `.git/info/exclude` hay file ignore toàn cục (`core.excludesFile`), file đánh dấu `assume-unchanged` hay `skip-worktree`, submodule đặt `ignore`.
- Agent không gọi tên được `.claude/settings.local.json` trong Bash, nên thường commit bằng `git add -A`; Claude Code thường thêm file này vào gitignore toàn cục, và thiếu dòng đó thì file có thể bị commit.
- Claude Code không chạy Stop khi bấm Esc: ngắt không bị tính là không tiến triển, nhưng agent cũng không bị giữ lại.
- `.verid/blocked.md` là lời agent tự khai: agent có thể khai kẹt giả (nhưng khi đó nó dừng hẳn).
- Lời khai kẹt chỉ được chốt khi một hook thấy `.verid/blocked.md` (ở một lần Stop hay một lần gọi tool có ghi file): một script xoá file trước mà hook không đọc ra là có ghi, như `node cleanup.js`, thì không để lại lời khai kẹt nào.
- "Không tiến triển" chỉ dựa trên những gì hook thấy: Bash ghi file mà hook không nhận ra thì không tính là tiến triển.
- Bộ đếm không tiến triển chỉ so mỗi lần Stop với lần ngay trước: kết quả cứ đổi mà không thật sự tiến (một test chập chờn, một byte của `.verid/plan.md` bật tắt qua lại, commit rỗng) làm nó về 0, nên vòng lặp đó không bị chặn.
- Khi đang kẹt, một lần ghi code cần hai `/verid tip` (khoá kẹt, rồi không có module mở), như mọi lần gọi vướng hai rule.
- Auto giữ mọi lần Stop bất kể `stop_hook_active` nói gì: nếu Claude Code đổi nghĩa của cờ đó, agent có thể dừng giữa chừng.

**Runner**

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
- Glob không phân biệt hoa thường trên mọi hệ điều hành.

**Tự bảo vệ và override**

- Chỉ `dist/` của verid được bảo vệ: sửa `i18n/*.json` đổi được thông báo, không đổi được quyết định.
- Agent không ghi được định nghĩa agent hay plugin nhưng vẫn ghi được skill (`.claude/skills/`); hook trong frontmatter của skill hay subagent và trong plugin chạy mà không bị kiểm tra, có thể sửa input của tool sau khi verid đã xét.
- Bash nhắc tới `.claude/agents` hay `.claude/plugins` bị chặn kể cả khi chỉ đọc (hãy dùng Read hoặc Glob); subagent của project do developer sửa, không phải agent.
- Bash nhắc tới bất kỳ file nào tên `manifest.yaml` bị chặn kể cả khi chỉ đọc, như `cat .verid/manifest.yaml`: hãy dùng Read, hoặc `/verid tip`.
- Xoá `.verid` làm mọi lần gọi tool bị chặn.
- Lệnh của developer và `CLAUDECODE` được chặn khỏi Bash của agent chỉ theo tên: qua script, biến hay chuỗi ghép lúc chạy, agent có thể tự ghi baseline, tự duyệt hay tự đóng module của mình, hoặc ở auto tự ký design hay chạy tiếp một drive đang kẹt.
- Bash của agent thừa hưởng `CLAUDE_CODE_SESSION_ATTENDED`: lệnh nhắc tới hook của verid bị chặn, nhưng qua bản copy của hook, một script hay đường dẫn ghép lúc chạy, agent có thể tự cấp override cho mình.
- Công cụ giả terminal như `node-pty` có thể mở một phiên lồng mà Claude Code coi là có người ngồi.
- Mã xác nhận vẫn nằm trong transcript trên đĩa, nơi agent bị chặn đọc.
- Override dựa vào biến nội bộ `CLAUDE_CODE_SESSION_ATTENDED` của Claude Code: nếu biến này bị đổi tên thì override ngừng hoạt động và mọi thứ vẫn bị chặn.
- Override chỉ gỡ đúng rule nó nêu; các rule khác, luật vai trò và cổng TDD vẫn xét lần gọi đó, và rule nào vẫn chặn thì cần `/verid tip` riêng.
- Thứ verid không đọc được thì lọt qua khi shell của nó đã được cho phép: một lần gọi PowerShell đã được cho qua thì không bị xét gì thêm, còn tool MCP có `command` chỉ bị xét trên các đường dẫn mà input của nó nêu.
- Màn hình cài đặt cần một terminal thật, và được kiểm thử bằng một terminal giả lập.
- Dòng trạng thái, đường dẫn file và chi tiết lỗi phân tích vẫn bằng tiếng Anh; payload của hook không phải JSON thì nhận cả hai thứ tiếng.
- Khi tải cao, một lần gọi bị chặn có thể nhận `VERID_BURNT_LOCK_TIMEOUT`: vẫn bị chặn, nhưng không được đếm.

## Phát triển

```bash
npm test             # build, rồi chạy unit test và end-to-end test
npm run typecheck
npm run format
```

Không có CI: `test/e2e/hook.e2e.test.ts` chạy lại payload ghi từ Windows, nên hãy chạy `npm test` trên Windows trước mỗi commit.

## Ghi nhận

verid đứng trên vai hai project:

- **[superpowers](https://github.com/obra/superpowers)** của Jesse Vincent: vòng của verid là vòng RED-GREEN-REFACTOR của skill `test-driven-development`, và "evidence before claims" lấy từ `verification-before-completion`. verid thêm hook để ép chúng.
- **[andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)** của forrestchang: nghĩ trước khi code, ưu tiên đơn giản, sửa đúng chỗ, làm theo mục tiêu kiểm chứng được.

verid là project độc lập, không liên kết với hai project trên.

## Giấy phép

MIT, xem [LICENSE](./LICENSE).
