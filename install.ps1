# Windows PowerShell 5.1+: irm https://raw.githubusercontent.com/anhtranhai835/verid/main/install.ps1 | iex
& {
  $ErrorActionPreference = 'Stop'
  $version = if ([string]::IsNullOrEmpty($env:VERID_VERSION)) { 'latest' } else { $env:VERID_VERSION }
  if ($version -cnotmatch '^[0-9A-Za-z][0-9A-Za-z.+-]*$' -or $version.Contains("`n")) {
    throw 'VERID_VERSION must be a version or tag, e.g. 1.1.0 or latest.'
  }
  $nodeCheck = "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 22 or later from https://nodejs.org, reopen your terminal, and run this installer again.'
  }
  & node -e $nodeCheck
  if ($LASTEXITCODE -ne 0) {
    throw 'Node.js 22 or later is required. Get it at https://nodejs.org and reopen your terminal.'
  }
  Write-Host "Installing @anhtranhai835/verid@$version"
  & npm.cmd install -g "@anhtranhai835/verid@$version"
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Resolve the npm error and run this installer again.' }

  $pluginCommands = @(
    @('plugin', 'marketplace', 'add', 'obra/superpowers-marketplace'),
    @('plugin', 'install', 'superpowers@superpowers-marketplace'),
    @('plugin', 'marketplace', 'add', 'forrestchang/andrej-karpathy-skills'),
    @('plugin', 'install', 'andrej-karpathy-skills@karpathy-skills'),
    @('plugin', 'marketplace', 'add', 'anhtranhai835/verid'),
    @('plugin', 'install', 'verid@verid')
  )
  $claudeCommand = Get-Command claude.cmd, claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $claudeScript = if (-not $claudeCommand) { Get-Command claude.ps1 -CommandType ExternalScript -ErrorAction SilentlyContinue }
  foreach ($pluginArgs in $pluginCommands) {
    $manual = 'claude ' + ($pluginArgs -join ' ')
    if (-not $claudeCommand) {
      if ($claudeScript) { Write-Host "Claude Code has only a PowerShell script shim; run manually: $manual" }
      else { Write-Host "After installing Claude Code, run: $manual" }
      continue
    }
    try {
      & $claudeCommand @pluginArgs
      if ($LASTEXITCODE -ne 0) { Write-Host "Plugin setup did not complete; if needed, run: $manual" }
    } catch {
      Write-Host "Plugin setup did not complete; if needed, run: $manual"
    }
  }

  $next = 'Next: cd <your project folder>; verid cook'
  $ciValue = "$env:CI".Trim().ToLowerInvariant()
  if (@('', 'false', '0') -notcontains $ciValue -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
    Write-Host $next
    return
  }
  $folder = (Read-Host 'Project folder (leave empty to finish)').Trim().Trim('"')
  if (-not $folder) { Write-Host $next; return }
  if ($folder -eq '~') { $folder = $HOME }
  elseif ($folder.StartsWith('~/') -or $folder.StartsWith('~\')) { $folder = Join-Path $HOME $folder.Substring(2) }
  if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw 'Choose an existing project folder.' }
  $target = Get-Item -LiteralPath $folder
  if ($target.FullName.TrimEnd('\', '/') -eq (Get-Item -LiteralPath $HOME).FullName.TrimEnd('\', '/')) {
    Write-Host 'Choose a project folder other than your home folder.'
    Write-Host $next
    return
  }
  if (-not (Get-Command verid.cmd -CommandType Application -ErrorAction SilentlyContinue)) { Write-Host "Reopen your terminal. $next"; return }
  Push-Location -LiteralPath $target.FullName
  try {
    & verid.cmd cook
    if ($LASTEXITCODE -ne 0) { throw 'verid cook failed. Resolve its message and run verid cook again in the project.' }
  } finally { Pop-Location }
}
