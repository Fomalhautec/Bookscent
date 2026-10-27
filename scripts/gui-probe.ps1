# Probe which Chromium switch set lets Electron create a window on this machine.
# ASCII-only source (Windows PowerShell 5.1 reads BOM-less files as ANSI).
$ErrorActionPreference = 'Continue'

$root = (Get-Location).Path
$probeDir = Join-Path $root '.gui-probe'
New-Item -ItemType Directory -Force -Path $probeDir | Out-Null

$mainJs = @'
const { app, BrowserWindow } = require('electron')
process.on('uncaughtException', (e) => { console.log('UNCAUGHT ' + e.message); process.exit(9) })
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 420, height: 260, show: false, frame: false })
  w.loadURL('data:text/html,<h1>ok</h1>')
  console.log('WINDOW_OK')
  setTimeout(() => { console.log('ALIVE'); app.exit(0) }, 1200)
}).catch((e) => { console.log('READY_FAIL ' + e.message); process.exit(8) })
'@
Set-Content -Encoding ASCII -Path (Join-Path $probeDir 'main.js') -Value $mainJs
'{"name":"probe","version":"1.0.0","main":"main.js"}' | Set-Content -Encoding ASCII -Path (Join-Path $probeDir 'package.json')

$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

$cases = @(
  @{ name = 'baseline';                    args = @() },
  @{ name = 'disable-gpu';                 args = @('--disable-gpu') },
  @{ name = 'gpu+no-software-rasterizer';  args = @('--disable-gpu', '--disable-software-rasterizer') },
  @{ name = 'disable-gpu-compositing';     args = @('--disable-gpu-compositing') },
  @{ name = 'disable-direct-composition';  args = @('--disable-direct-composition') },
  @{ name = 'use-angle=swiftshader';       args = @('--use-angle=swiftshader') },
  @{ name = 'use-angle=d3d11';             args = @('--use-angle=d3d11') },
  @{ name = 'in-process-gpu';              args = @('--in-process-gpu') },
  @{ name = 'no-sandbox';                  args = @('--no-sandbox') },
  @{ name = 'no-sandbox+disable-gpu';      args = @('--no-sandbox', '--disable-gpu') },
  @{ name = 'disable-d3d11';               args = @('--disable-d3d11') },
  @{ name = 'disable-features=WinOcclusion'; args = @('--disable-features=CalculateNativeWinOcclusion') },
  @{ name = 'swiftshader+in-process-gpu';  args = @('--use-angle=swiftshader', '--in-process-gpu', '--disable-gpu-compositing') }
)

$results = @()

foreach ($case in $cases) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $electron
  $argList = @($probeDir) + $case.args
  $psi.Arguments = ($argList | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
  $psi.WorkingDirectory = $probeDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true

  $p = [System.Diagnostics.Process]::Start($psi)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  Start-Sleep -Milliseconds 6000
  $exited = $p.HasExited
  $code = $null
  if ($exited) { $code = $p.ExitCode } else { try { $p.Kill() } catch {} }
  Start-Sleep -Milliseconds 400

  $out = $outTask.Result
  $err = $errTask.Result
  $verdict = if (-not $exited) { 'HANG/killed' } elseif ($out -match 'ALIVE') { 'OK' } else { "CRASH exit=$code" }

  $results += [pscustomobject]@{
    case = $case.name
    verdict = $verdict
    sawWindow = ($out -match 'WINDOW_OK')
    exitCode = $code
    stdout = ($out -replace "`r?`n", ' / ').Trim()
  }
  Write-Host ("{0,-32} {1,-16} window={2}" -f $case.name, $verdict, ($out -match 'WINDOW_OK'))
}

Write-Host ''
Write-Host '=== summary ==='
$results | Format-Table -AutoSize
