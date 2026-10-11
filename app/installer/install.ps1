# KB25 installer for Windows. In PowerShell:
#
#   irm https://github.com/elmir-mamedov/kb/releases/latest/download/install.ps1 | iex
#
# Fetches a private copy of Node.js and the latest KB25 release into
# %LOCALAPPDATA%\KB25, then hands over to installer\setup.mjs for the
# questions. Needs no admin rights and touches nothing system-wide. Running it
# again updates KB25, or offers to remove it.
#
# For testing: KB25_HOME overrides the install folder, KB25_ZIP installs a
# local kb25.zip instead of the latest release, KB25_YES=1 takes every default.
# KB25_UPDATE=1 is the viewer's Update button: no questions (installer\setup.mjs
# keeps every earlier choice and restarts the server).

# One script block, so a download cut short can never run half a script, and
# `return` (never `exit`, which would close the window `iex` runs in) ends it.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # the progress bar slows downloads to a crawl
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $nodeVersion = '24.15.0'
  $release = 'https://github.com/elmir-mamedov/kb/releases/latest/download/kb25.zip'
  $kbHome = if ($env:KB25_HOME) { $env:KB25_HOME } else { Join-Path $env:LOCALAPPDATA 'KB25' }

  function Ask($question) {
    if ($env:KB25_YES -or $env:KB25_UPDATE) { return $true }
    $reply = Read-Host "$question [Y/n]"
    return -not ($reply -match '^\s*[nN]')
  }

  function Stop-KB25Server {
    $pidFile = Join-Path $kbHome 'server.pid'
    if (Test-Path $pidFile) {
      $serverPid = [int](Get-Content $pidFile -Raw)
      Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $serverPid -Timeout 5 -ErrorAction SilentlyContinue
      Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
  }

  $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'x64' }
    'ARM64' { 'arm64' }
    default { $null }
  }
  if (-not $arch) {
    Write-Host "Unsupported processor: $env:PROCESSOR_ARCHITECTURE"
    return
  }

  Write-Host ''
  Write-Host 'KB25 installer'
  if (Test-Path (Join-Path $kbHome 'app')) {
    if (-not (Ask 'KB25 is already installed. Check for an update?')) { return }
  } else {
    if (-not (Ask 'This installs KB25 for you only. No admin rights needed. Continue?')) { return }
  }
  New-Item -ItemType Directory -Force -Path $kbHome | Out-Null

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("kb25-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $nodeDir = Join-Path $kbHome 'node'
    $nodeVersionFile = Join-Path $nodeDir 'VERSION'
    $installedNode = if (Test-Path $nodeVersionFile) { (Get-Content $nodeVersionFile -Raw).Trim() } else { '' }
    if ($installedNode -ne $nodeVersion) {
      Write-Host 'Downloading Node.js, which only KB25 uses (about 35 MB, first time only)...'
      Stop-KB25Server # it runs on the Node about to be replaced
      $name = "node-v$nodeVersion-win-$arch"
      $nodeZip = Join-Path $tmp 'node.zip'
      Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v$nodeVersion/$name.zip" -OutFile $nodeZip
      $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt").Content
      $expected = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape("$name.zip"))$" } | ForEach-Object { ($_ -split '\s+')[0] })
      $actual = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLower()
      if (-not $expected -or $expected -ne $actual) {
        Write-Host 'The Node.js download looks damaged. Please try again.'
        return
      }
      Expand-Archive $nodeZip -DestinationPath $tmp -Force
      if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
      Move-Item (Join-Path $tmp $name) $nodeDir
      Set-Content -Path $nodeVersionFile -Value $nodeVersion
    }

    Write-Host 'Downloading KB25...'
    $zip = Join-Path $tmp 'kb25.zip'
    if ($env:KB25_ZIP) {
      Copy-Item $env:KB25_ZIP $zip
    } else {
      Invoke-WebRequest -UseBasicParsing $release -OutFile $zip
    }
    $staged = Join-Path $kbHome 'app.new'
    if (Test-Path $staged) { Remove-Item $staged -Recurse -Force }
    Expand-Archive $zip -DestinationPath $staged -Force

    & (Join-Path $nodeDir 'node.exe') (Join-Path $staged 'installer\setup.mjs')
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
