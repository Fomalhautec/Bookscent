# Generates the Bookscent app icon: a multi-size ICO plus a 256px PNG.
# Drawn with System.Drawing only (ASCII-only source so Windows PowerShell 5.1 parses it correctly).
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = [System.IO.Path]::GetFullPath((Join-Path $root '..\build'))
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

function New-RoundedPath {
  param([int]$x, [int]$y, [int]$w, [int]$h, [int]$r)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
  $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
  $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Color {
  param([int]$a, [int]$r, [int]$g, [int]$b)
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

function New-IconBitmap {
  param([int]$size)

  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = [double]$size / 256.0

  # Warm wooden rounded plate
  $bgPath = New-RoundedPath 8 8 240 240 46
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(8, 8)),
    (New-Object System.Drawing.Point(248, 248)),
    (New-Color 255 176 122 66),
    (New-Color 255 96 60 30))
  $g.FillPath($bgBrush, $bgPath)
  $bgBrush.Dispose()
  $bgPath.Dispose()

  # Recessed shelf cavity
  $cavity = New-RoundedPath 26 30 204 176 20
  $cavityBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(26, 30)),
    (New-Object System.Drawing.Point(26, 206)),
    (New-Color 255 62 38 20),
    (New-Color 255 40 24 12))
  $g.FillPath($cavityBrush, $cavity)
  $cavityBrush.Dispose()
  $cavity.Dispose()

  # Four book spines
  $defs = @(
    @{ x = 44;  w = 34; top = 68; r1 = 138; g1 = 68;  b1 = 56;  r2 = 96;  g2 = 44;  b2 = 36;  fr = 214; fg = 178; fb = 106 },
    @{ x = 84;  w = 42; top = 54; r1 = 58;  g1 = 96;  b1 = 86;  r2 = 38;  g2 = 68;  b2 = 60;  fr = 206; fg = 186; fb = 132 },
    @{ x = 132; w = 30; top = 80; r1 = 216; g1 = 202; b1 = 174; r2 = 176; g2 = 158; b2 = 128; fr = 150; fg = 122; fb = 74  },
    @{ x = 168; w = 38; top = 46; r1 = 62;  g1 = 78;  b1 = 108; r2 = 42;  g2 = 54;  b2 = 78;  fr = 201; fg = 162; fb = 39  }
  )

  $bottomY = [int][math]::Round(206 * $s)

  foreach ($d in $defs) {
    $x = [int][math]::Round($d.x * $s)
    $w = [int][math]::Round($d.w * $s)
    $top = [int][math]::Round($d.top * $s)
    $h = $bottomY - $top
    if ($w -lt 2 -or $h -lt 3) { continue }

    $rect = New-Object System.Drawing.Rectangle($x, $top, $w, $h)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      $rect,
      (New-Color 255 $d.r1 $d.g1 $d.b1),
      (New-Color 255 $d.r2 $d.g2 $d.b2),
      [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # Left highlight to fake cylindrical lighting
    if ($w -ge 7) {
      $hlX = $x + [int][math]::Round($w * 0.24)
      $hlW = [math]::Max(1, [int][math]::Round($w * 0.16))
      $hlBrush = New-Object System.Drawing.SolidBrush((New-Color 46 255 255 255))
      $g.FillRectangle($hlBrush, $hlX, $top, $hlW, $h)
      $hlBrush.Dispose()
    }

    # Foil rules
    if ($h -ge 26 -and $w -ge 11) {
      $lineH = [math]::Max(1, [int][math]::Round(1.6 * $s))
      $foilBrush = New-Object System.Drawing.SolidBrush((New-Color 195 $d.fr $d.fg $d.fb))
      $inset = [int][math]::Round($w * 0.18)
      $lineW = $w - $inset * 2
      $y1 = $top + [int][math]::Max(4, 13 * $s)
      $y2 = $bottomY - [int][math]::Max(7, 21 * $s)
      $g.FillRectangle($foilBrush, ($x + $inset), $y1, $lineW, $lineH)
      $g.FillRectangle($foilBrush, ($x + $inset), $y2, $lineW, $lineH)
      $foilBrush.Dispose()
    }
  }

  # Plank
  $plankTop = [int][math]::Round(200 * $s)
  $plankH = [math]::Max(4, [int][math]::Round(30 * $s))
  $plankPath = New-RoundedPath 20 $plankTop 216 $plankH 8
  $plankBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(20, $plankTop, 216, $plankH)),
    (New-Color 255 200 150 90),
    (New-Color 255 122 80 38),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.FillPath($plankBrush, $plankPath)
  $plankBrush.Dispose()
  $plankPath.Dispose()

  # Plank top highlight
  $topEdge = New-Object System.Drawing.SolidBrush((New-Color 150 255 232 196))
  $edgeH = [math]::Max(1, [int][math]::Round(2.5 * $s))
  $g.FillRectangle($topEdge, 22, ($plankTop + 1), 212, $edgeH)
  $topEdge.Dispose()

  $g.Dispose()
  return $bmp
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = New-Object System.Collections.ArrayList

foreach ($size in $sizes) {
  $bmp = New-IconBitmap -size $size
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [void]$frames.Add(@{ size = $size; bytes = $ms.ToArray() })
  $ms.Dispose()
  if ($size -eq 256) { $bmp.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
}

# Hand-written ICO container (Vista+ allows PNG payloads per frame)
$icoPath = Join-Path $outDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$frames.Count)

$offset = 6 + 16 * $frames.Count
foreach ($frame in $frames) {
  $dim = [int]$frame.size
  if ($dim -ge 256) { $dimByte = [byte]0 } else { $dimByte = [byte]$dim }
  $bw.Write($dimByte)
  $bw.Write($dimByte)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$frame.bytes.Length)
  $bw.Write([UInt32]$offset)
  $offset = $offset + $frame.bytes.Length
}
foreach ($frame in $frames) { $bw.Write($frame.bytes) }
$bw.Flush()
$bw.Close()
$fs.Close()

Write-Host ("OK icon.ico {0} bytes" -f (Get-Item $icoPath).Length)
Write-Host ("OK icon.png {0} bytes" -f (Get-Item (Join-Path $outDir 'icon.png')).Length)
Get-ChildItem $outDir | Select-Object Name, Length | Format-Table -AutoSize
