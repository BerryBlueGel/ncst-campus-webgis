$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outputPath = Join-Path $PSScriptRoot '../reference/south_gate/south_gate_nameplate.png'
$width = 512
$height = 2048
$bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$font = New-Object System.Drawing.Font('Microsoft YaHei', 118, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 27, 48, 63))
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center

$characters = @('华', '北', '理', '工', '大', '学')
$top = 120
$step = 300
for ($index = 0; $index -lt $characters.Count; $index++) {
    $rect = New-Object System.Drawing.RectangleF(0, ($top + $index * $step), $width, 220)
    $graphics.DrawString($characters[$index], $font, $brush, $rect, $format)
}

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$format.Dispose()
$brush.Dispose()
$font.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Get-Item -LiteralPath $outputPath | Select-Object FullName, Length, LastWriteTime
