import { describe, expect, it } from "vitest";
import { powershellWriteTargets } from "../../src/core/powershell.js";

describe("PowerShell targets", () => {
  it("finds plain write targets for redirects, cmdlets, aliases and literal methods", () => {
    const rows = [
      {
        command: "'x' > 'src/a.ts'; 'y' 2>> test/a.test.ts",
        targets: ["src/a.ts", "test/a.test.ts"],
      },
      {
        command: "Set-Content -LiteralPath 'src/a.ts' -Value 'x'; Add-Content src/b.ts 'y'",
        targets: ["src/a.ts", "src/b.ts"],
      },
      {
        command: "'x' | Out-File -FilePath src/a.ts; 'x' | Tee-Object -FilePath src/b.ts",
        targets: ["src/a.ts", "src/b.ts"],
      },
      {
        command: "sc src/a.ts x; ac src/b.ts y; 'x' | tee src/c.ts",
        targets: ["src/a.ts", "src/b.ts", "src/c.ts"],
      },
      {
        command: "New-Item -Path src -Name a.ts -ItemType File; ni src/b.ts",
        targets: ["src", "src/a.ts", "src/b.ts"],
      },
      {
        command: "Copy-Item -Path source/a.ts -Destination src; cp source/b.ts src/c.ts",
        targets: ["src", "src/a.ts", "src/c.ts", "src/c.ts/b.ts"],
      },
      {
        command: "Move-Item source/a.ts src/b.ts; mi -LiteralPath source/c.ts -Destination src",
        targets: ["source/a.ts", "src/b.ts", "src/b.ts/a.ts", "source/c.ts", "src", "src/c.ts"],
      },
      {
        command: "Rename-Item -Path src/a.ts -NewName b.ts; ren src/c.ts d.ts",
        targets: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      },
      {
        command:
          "Remove-Item -Recurse -Force src/a.ts,src/b.ts; del src/c.ts; erase src/d.ts; rd src/e; rmdir src/f; rm src/g",
        targets: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e", "src/f", "src/g"],
      },
      {
        command:
          "[IO.File]::WriteAllText('src/a.ts', 'value'); [System.IO.File]::AppendAllText(\"src/b.ts\", \"value\"); [IO.File]::WriteAllBytes('src/c.ts', $bytes)",
        targets: ["src/a.ts", "src/b.ts", "src/c.ts"],
      },
      {
        command:
          'cmd /c "echo x > src/a.ts & copy source/b.ts src/c.ts & move source/d.ts src/e.ts & del src/f.ts"',
        targets: [
          "src/a.ts",
          "src/c.ts",
          "src/c.ts/b.ts",
          "source/d.ts",
          "src/e.ts",
          "src/e.ts/d.ts",
          "src/f.ts",
        ],
      },
      {
        command: "powershell -NoProfile -Command 'Set-Content \"src/a.ts\" x'",
        targets: ["src/a.ts"],
      },
      { command: 'pwsh -c "Remove-Item src/a.ts"', targets: ["src/a.ts"] },
      {
        command: "Microsoft.PowerShell.Management\\Set-Content -Path src/a.ts -Value x",
        targets: ["src/a.ts"],
      },
      {
        command: "Set-Content -Path src/a.ts,src/b.ts -Value @('x','y')",
        targets: ["src/a.ts", "src/b.ts"],
      },
      { command: "& 'C:\\Tools\\writer.ps1' 'arg'", targets: [] },
      { command: "Set-Content -Path:'src/a.ts' -Value x", targets: ["src/a.ts"] },
      { command: "Write-Output ([IO.File]::WriteAllText('src/a.ts', 'x'))", targets: ["src/a.ts"] },
      { command: "Write-Output (Set-Content src/a.ts x)", targets: ["src/a.ts"] },
      {
        command: "cmd /c 'copy /Y source/a.ts src/b.ts & del /F /Q src/c.ts'",
        targets: ["src/b.ts", "src/b.ts/a.ts", "src/c.ts"],
      },
      {
        command: "pwsh -c 'Set-Content src/a.ts x'; git status --short",
        targets: ["src/a.ts"],
      },
      {
        command: "Clear-Content src/a.ts; clc src/b.ts; mkdir src/c; md src/d",
        targets: ["src/a.ts", "src/b.ts", "src/c", "src/d"],
      },
      {
        command: "cmd /c 'mkdir src/a src/b & md src/c src/d'",
        targets: ["src/a", "src/b", "src/c", "src/d"],
      },
    ];
    for (const row of rows)
      expect(powershellWriteTargets(row.command), row.command).toEqual({ targets: row.targets });
  });

  it("rejects executable text and dynamic write targets it cannot inspect", () => {
    const rows = [
      "Invoke-Expression $text",
      "iex 'Set-Content src/a.ts x'",
      "pwsh -EncodedCommand AAA=",
      "powershell.exe -enc AAA=",
      "[ScriptBlock]::Create($text)",
      "[scriptblock]::Create('x')",
      'pwsh -Command "$cmd"',
      "powershell -Command $command",
      "pwsh -c ('Set-' + $command)",
      "& $program arg",
      "& ($program) arg",
      "& (Get-Command Set-Content) file x",
      "Set-Content -Path $target -Value x",
      'Set-Content -Path "src/$name.ts" -Value x',
      "Out-File -FilePath (Join-Path src a.ts)",
      "[IO.File]::WriteAllText($path, 'x')",
      "cmd /c $text",
      'cmd /c "echo x > $target"',
      "Set-Content -Path src/a.ts -Value 'unterminated",
      "Set-Content @params",
      "&('Set-Content') src/a.ts x",
      "Start-Process pwsh -Command $text",
      "Start-Process powershell -EncodedCommand AAA=",
      "Start-Process -FilePath 'powershell.exe' -ArgumentList '-EncodedCommand','AAA='",
      "Start-Process -FilePath 'pwsh.exe' -ArgumentList '-Command',$text",
      "Start-Process 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' -ArgumentList '-Command',('Set-' + $name)",
      "saps 'pwsh.exe' -ArgumentList '-EncodedCommand AAA='",
      "start 'powershell.exe' -ArgumentList '-Command',$text",
      "Start-Process -FilePath $program -ArgumentList $text",
      'Write-Output "$(Invoke-Expression $text)"',
      'Write-Output "$(Set-Content src/a.ts x)"',
      'Write-Output "$(pwsh -EncodedCommand AAA=)"',
      'Write-Output "$(Get-Date)"',
    ];
    for (const command of rows)
      expect(powershellWriteTargets(command), command).toHaveProperty("unsupported");
  });

  it("leaves test, git and ordinary verid commands usable", () => {
    const rows = [
      "npx verid taste",
      "npm test",
      "git diff -- src",
      "git status --short",
      "npx vitest run",
      "Get-Content -Raw design.md",
      "Write-Output 'hello'",
      "& 'C:\\node.exe' 'cli.js' taste",
      "Write-Output 'Invoke-Expression is forbidden'; Write-Output 'Set-Content src/a.ts x'",
      "node -e \"require('fs').writeFileSync('marker.txt', 'ok')\"",
    ];
    for (const command of rows)
      expect(powershellWriteTargets(command), command).toEqual({ targets: [] });
  });
});
