# Installs Circuit on Windows. In PowerShell:
#
#   irm https://circuit.tako.id/install.ps1 | iex
#
# Circuit goes in %LOCALAPPDATA%\Programs\Circuit, like an app: added to your PATH and listed in Settings > Apps. Run it again to update.
# It asks before updating an app already there. A project in this folder (circuit.ts) is set up as it is; anywhere else, Circuit offers to start one.
# Answer no to the first question for a full install: Circuit stays inside one new project, run with Bun, and nothing goes on PATH.
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
# The release key, as ssh-keygen reads it: the key in src/cli/signing.ts, which signs each release's SHA256SUMS.
$signers = 'circuit-release namespaces="circuit-release" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBFYvLbjJKwTIciNuNZgVLU0Du53aFUYxuywTEG5zshM'

if (-not [Environment]::Is64BitOperatingSystem) { Stop-Install "Circuit needs 64-bit Windows." }

# ssh-keygen checks the release's signature: Windows 10 and 11 carry it, as the OpenSSH Client.
$sshKeygen = (Get-Command ssh-keygen -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $sshKeygen -and (Test-Path "$env:WINDIR\System32\OpenSSH\ssh-keygen.exe")) { $sshKeygen = "$env:WINDIR\System32\OpenSSH\ssh-keygen.exe" }
if (-not $sshKeygen) { Stop-Install "this needs ssh-keygen to check that the release is signed. Add OpenSSH Client in Settings > System > Optional features." }

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
# The line that is a version: Circuit 1.0.0-rc.1 updates itself first and says so.
if (Test-Path $target) { try { $installed = (& $target --version 2>$null | Where-Object { $_ -match '^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$' } | Select-Object -Last 1) } catch {} }

$interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected

# A yes or no question. $default is the answer an Enter gives; without a person to answer, the default.
function Ask($question, [bool]$default) {
    if (-not $interactive) { return $default }
    $hint = if ($default) { "Y/n" } else { "y/N" }
    $answer = Read-Host "$question [$hint]"
    if ($answer -match '^(y|yes)$') { return $true }
    if ($answer -match '^(n|no)$') { return $false }
    return $default
}

# Download circuit.exe to $destination, checked against the release's SHA256SUMS, itself checked against the release key's signature.
function Get-Circuit($destination) {
    $work = Join-Path ([IO.Path]::GetTempPath()) ("circuit-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Force $work | Out-Null
    try {
        $base = "https://github.com/$repo/releases/download/v$version"
        try {
            Invoke-WebRequest -UseBasicParsing "$base/$asset" -OutFile (Join-Path $work $asset)
            Invoke-WebRequest -UseBasicParsing "$base/SHA256SUMS" -OutFile (Join-Path $work "SHA256SUMS")
            Invoke-WebRequest -UseBasicParsing "$base/SHA256SUMS.sshsig" -OutFile (Join-Path $work "SHA256SUMS.sshsig")
        }
        catch { Stop-Install "could not download Circuit $version." }

        # ssh-keygen reads SHA256SUMS from a file, byte for byte: a PowerShell pipe would change its line ends.
        [IO.File]::WriteAllText((Join-Path $work "allowed_signers"), "$signers`n")
        $verify = @("-Y", "verify", "-f", "`"$work\allowed_signers`"", "-I", "circuit-release", "-n", "circuit-release", "-s", "`"$work\SHA256SUMS.sshsig`"")
        $check = Start-Process -FilePath $sshKeygen -ArgumentList $verify -RedirectStandardInput (Join-Path $work "SHA256SUMS") -RedirectStandardOutput (Join-Path $work "verify.out") -RedirectStandardError (Join-Path $work "verify.err") -NoNewWindow -Wait -PassThru
        if ($check.ExitCode -ne 0) { Stop-Install "the release's SHA256SUMS is not signed with Circuit's release key." }

        $line = Get-Content (Join-Path $work "SHA256SUMS") | Where-Object { $_ -match " $([regex]::Escape($asset))$" } | Select-Object -First 1
        $expected = if ($line) { ($line -split "\s+")[0] } else { "" }
        $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $work $asset)).Hash.ToLower()
        if (-not $expected -or $expected -ne $actual) { Stop-Install "$asset does not match the release's SHA256SUMS." }

        New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
        # A running circuit.exe cannot be overwritten, but it can be renamed; circuit removes the old file on its next run.
        if (Test-Path $destination) {
            Remove-Item -Force "$destination.old" -ErrorAction SilentlyContinue
            Rename-Item $destination ((Split-Path $destination -Leaf) + ".old")
        }
        Move-Item (Join-Path $work $asset) $destination
    }
    finally {
        Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    }
}

# A full install keeps Circuit inside one new project, run with Bun: nothing goes on PATH. Offered only where no app is installed and no project is.
if (-not $installed -and -not (Test-Path "circuit.ts") -and $env:CIRCUIT_NO_SETUP -ne "1" -and $interactive) {
    if (-not (Ask "Install Circuit as an app? Answer no to keep it inside one new project only, run with Bun." $true)) {
        $once = Join-Path ([IO.Path]::GetTempPath()) ("circuit-once-" + [Guid]::NewGuid() + "\circuit.exe")
        Get-Circuit $once
        & $once new --full
        Remove-Item -Recurse -Force (Split-Path $once) -ErrorAction SilentlyContinue
        return
    }
}

if ($installed -eq $version) {
    Write-Host "Circuit $version is installed already."
}
elseif ($installed) {
    # Updating the app changes no project: each runs the version in its .circuit/version.
    if (Ask "Circuit $installed is installed. Update the app to $version? Your projects keep the version they pin." $false) {
        Get-Circuit $target
        Write-Host "Circuit $version is installed."
    }
    else {
        Write-Host "Kept Circuit $installed."
        $version = $installed
    }
}
else {
    Write-Host "Installing Circuit $version"
    Get-Circuit $target
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

if ($env:CIRCUIT_NO_SETUP -eq "1") { return }

# A project here, such as a fresh clone, is set up as it is. Anywhere else, Circuit offers to start one.
if (Test-Path "circuit.ts") { & $target setup }
elseif (Ask "Set up a new project in this folder?" $false) { & $target new }
