# Installs Circuit on Windows, then starts a project. In PowerShell:
#
#   irm https://circuit.tako.id/install.ps1 | iex
#
# It downloads circuit.exe from Circuit's GitHub releases, checks it against the release's SHA256SUMS, puts it in %USERPROFILE%\.circuit\bin,
# adds that folder to your PATH, and runs `circuit setup`, which asks a few questions and writes the project.
#
# $env:CIRCUIT_VERSION = "1.0.0" installs that version instead of the newest. $env:CIRCUIT_NO_SETUP = "1" installs without starting a project.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Windows PowerShell 5.1 may not offer TLS 1.2 by itself, which GitHub needs.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Stop-Install($message) {
    Write-Host "Circuit was not installed: $message" -ForegroundColor Red
    throw $message
}

$repo = "takodotid/circuit"
$binDir = Join-Path $HOME ".circuit\bin"
$asset = "circuit-windows-x64.exe"

if (-not [Environment]::Is64BitOperatingSystem) { Stop-Install "Circuit needs 64-bit Windows." }

$version = $env:CIRCUIT_VERSION
if (-not $version) {
    try { $version = (Invoke-RestMethod -UseBasicParsing "https://circuit.tako.id/latest.json").latest }
    catch { Stop-Install "could not reach circuit.tako.id to learn the newest version." }
    if (-not $version) { Stop-Install "circuit.tako.id/latest.json does not name a version." }
}

Write-Host "Installing Circuit $version for Windows"

$work = Join-Path ([IO.Path]::GetTempPath()) ("circuit-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Force $work | Out-Null

try {
    $base = "https://github.com/$repo/releases/download/v$version"
    try {
        Invoke-WebRequest -UseBasicParsing "$base/$asset" -OutFile (Join-Path $work $asset)
        Invoke-WebRequest -UseBasicParsing "$base/SHA256SUMS" -OutFile (Join-Path $work "SHA256SUMS")
    }
    catch { Stop-Install "could not download Circuit $version." }

    $line = Get-Content (Join-Path $work "SHA256SUMS") | Where-Object { $_ -match " $([regex]::Escape($asset))$" } | Select-Object -First 1
    $expected = if ($line) { ($line -split "\s+")[0] } else { "" }
    $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $work $asset)).Hash.ToLower()
    if (-not $expected -or $expected -ne $actual) { Stop-Install "$asset does not match the release's SHA256SUMS." }

    New-Item -ItemType Directory -Force $binDir | Out-Null
    $target = Join-Path $binDir "circuit.exe"

    # A running circuit.exe cannot be overwritten, but it can be renamed; circuit removes the old file on its next run.
    if (Test-Path $target) {
        Remove-Item -Force "$target.old" -ErrorAction SilentlyContinue
        Rename-Item $target "circuit.exe.old"
    }
    Move-Item (Join-Path $work $asset) $target
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

# PATH: the user's own, so no administrator is needed.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($userPath -split ";") -contains $binDir)) {
    [Environment]::SetEnvironmentVariable("Path", (@($userPath, $binDir) | Where-Object { $_ }) -join ";", "User")
    Write-Host "Added $binDir to your PATH. Open a new terminal, and restart VS Code, to run circuit from anywhere."
}
if (-not (($env:Path -split ";") -contains $binDir)) { $env:Path = "$env:Path;$binDir" }

Write-Host "Circuit $version is installed: $target"

if ($env:CIRCUIT_NO_SETUP -ne "1") { & $target setup }
