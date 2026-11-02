# Installs Circuit on Windows. In PowerShell:
#
#   irm https://circuit.tako.id/install.ps1 | iex
#
# Circuit goes in %LOCALAPPDATA%\Programs\Circuit, like an app: added to your PATH and listed in Settings > Apps. Run it again to update.
# Then, in a folder with a project (circuit.ts), the project is set up as it is; anywhere else, Circuit offers to start one.
#
# $env:CIRCUIT_VERSION = "1.0.0" installs that version. $env:CIRCUIT_NO_SETUP = "1" installs only. `circuit uninstall` removes it.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Windows PowerShell 5.1 may not offer TLS 1.2 by itself, which GitHub needs.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Stop-Install($message) {
    Write-Host "Circuit was not installed: $message" -ForegroundColor Red
    throw $message
}

$repo = "takodotid/circuit"
$asset = "circuit-windows-x64.exe"
$folder = Join-Path $env:LOCALAPPDATA "Programs\Circuit"
$target = Join-Path $folder "circuit.exe"

if (-not [Environment]::Is64BitOperatingSystem) { Stop-Install "Circuit needs 64-bit Windows." }

# The newest Circuit 1 or later, from npm: the stable release, or the newest release candidate while there is none.
$version = $env:CIRCUIT_VERSION
if (-not $version) {
    try { $tags = Invoke-RestMethod -UseBasicParsing "https://registry.npmjs.org/-/package/@takodotid/circuit/dist-tags" }
    catch { Stop-Install "could not reach the npm registry to learn the newest version." }
    $version = $tags.latest
    if (-not $version -or $version.StartsWith("0.")) { $version = $tags.rc }
    if (-not $version) { Stop-Install "npm names no version of Circuit 1 yet." }
}

$installed = ""
if (Test-Path $target) { try { $installed = (& $target --version 2>$null | Select-Object -First 1) } catch {} }

if ($installed -eq $version) {
    Write-Host "Circuit $version is installed already."
}
else {
    if ($installed) { Write-Host "Updating Circuit $installed to $version" } else { Write-Host "Installing Circuit $version" }

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

        New-Item -ItemType Directory -Force $folder | Out-Null

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
}

# Settings > Apps lists Circuit, with an uninstall that runs `circuit uninstall`.
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Circuit"
New-Item -Force $key | Out-Null
Set-ItemProperty $key DisplayName "Circuit"
Set-ItemProperty $key DisplayVersion $version
Set-ItemProperty $key Publisher "Tako"
Set-ItemProperty $key InstallLocation $folder
Set-ItemProperty $key DisplayIcon $target
Set-ItemProperty $key UninstallString "`"$target`" uninstall"
Set-ItemProperty $key NoModify 1 -Type DWord
Set-ItemProperty $key NoRepair 1 -Type DWord

# PATH: the user's own, so no administrator is needed.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($userPath -split ";") -contains $folder)) {
    [Environment]::SetEnvironmentVariable("Path", (@($userPath, $folder) | Where-Object { $_ }) -join ";", "User")
    Write-Host "Added Circuit to your PATH. Open a new terminal, and restart VS Code, to run circuit from anywhere."
}
if (-not (($env:Path -split ";") -contains $folder)) { $env:Path = "$env:Path;$folder" }

if ($env:CIRCUIT_NO_SETUP -ne "1") { & $target setup }
