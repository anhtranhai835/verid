# Windows PowerShell 5.1+: gh api -H "Accept: application/vnd.github.raw" repos/anhtranhai835/verid/contents/install.ps1 | Out-String | iex
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
  # Releases are private: the tarball comes from a GitHub Release, read with the user's gh login.
  $gh = Get-Command gh.exe, gh.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $gh) {
    throw 'Install the GitHub CLI from https://cli.github.com, run gh auth login, and run this installer again.'
  }
  # Windows PowerShell turns native stderr into errors under 'Stop'.
  $ErrorActionPreference = 'Continue'
  & $gh auth status *> $null
  $authExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($authExit -ne 0) {
    throw 'Run gh auth login with an account that can read anhtranhai835/verid, then run this installer again.'
  }
  $download = Join-Path ([IO.Path]::GetTempPath()) ('verid-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $download | Out-Null
  # One list: Windows PowerShell passes an empty splatted array to a native command as "".
  $ghArgs = @('release', 'download')
  if ($version -ne 'latest') { $ghArgs += if ($version.StartsWith('v')) { $version } else { "v$version" } }
  $ghArgs += @('--repo', 'anhtranhai835/verid', '--pattern', '*.tgz', '--dir', $download)
  Write-Host "Installing verid $version from GitHub Releases"
  & $gh @ghArgs
  if ($LASTEXITCODE -ne 0) {
    throw 'Downloading the release failed. Check the version and that your GitHub account has read access to anhtranhai835/verid.'
  }
  $tarball = Get-ChildItem -LiteralPath $download -Filter '*.tgz' | Select-Object -First 1
  & npm.cmd install -g $tarball.FullName
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Resolve the npm error and run this installer again.' }
  Remove-Item -LiteralPath $download -Recurse -Force
  if ((Get-Command codex.cmd, codex -CommandType Application -ErrorAction SilentlyContinue) -and
      (Get-Command verid.cmd -CommandType Application -ErrorAction SilentlyContinue)) {
    & verid.cmd setup-codex
    if ($LASTEXITCODE -ne 0) { throw 'Codex reviewer setup failed. Resolve its message and run verid setup-codex again.' }
  }

  $pluginCommands = @(
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
