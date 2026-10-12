Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot "reference-vs-smile-comparison.png"
$canvasWidth = 1400
$canvasHeight = 1400
$imageWidth = 640
$imageHeight = 360
$leftX = 40
$rightX = 720
$firstRowY = 118
$rowStep = 408

$canvas = New-Object System.Drawing.Bitmap($canvasWidth, $canvasHeight)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 247, 244))
$ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 32, 29, 30))
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 111, 100, 98))
$rule = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 229, 211, 204), 1)
$titleFont = New-Object System.Drawing.Font("Segoe UI", 27, [System.Drawing.FontStyle]::Bold)
$subtitleFont = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Regular)
$labelFont = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$noteFont = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Regular)

$graphics.FillRectangle($background, 0, 0, $canvasWidth, $canvasHeight)
$graphics.DrawString("REFERENCE STYLE PROOF", $titleFont, $ink, 40, 25)
$graphics.DrawString("Three source-faithful portal states · original Smile artwork · 7.5-second silent style test", $subtitleFont, $muted, 42, 67)
$graphics.DrawLine($rule, 40, 98, 1360, 98)

$pairs = @(
    @{ Reference = "reference-frames\reference-10.0s.png"; Smile = "proof-frames\smile-0.8s.png"; RefLabel = "YOUTUBE STORYBOARD · ~10s · PROMPT / RESULT"; SmileLabel = "SOURCE-FAITHFUL UI · 0.8s · RESUME SCREENING" },
    @{ Reference = "reference-frames\reference-11.0s.png"; Smile = "proof-frames\smile-4.3s.png"; RefLabel = "YOUTUBE STORYBOARD · ~11s · STAGGERED ROWS"; SmileLabel = "SOURCE-FAITHFUL UI · 4.3s · APPLICANTS LIST" },
    @{ Reference = "reference-frames\reference-12.0s.png"; Smile = "proof-frames\smile-7.3s.png"; RefLabel = "YOUTUBE STORYBOARD · ~12s · SETTLED RESULT"; SmileLabel = "SOURCE-FAITHFUL UI · 7.3s · APPLICANT REVIEW" }
)

foreach ($index in 0..($pairs.Count - 1)) {
    $pair = $pairs[$index]
    $rowY = $firstRowY + ($index * $rowStep)
    $imageY = $rowY + 32
    $referencePath = Join-Path $projectRoot $pair.Reference
    $smilePath = Join-Path $projectRoot $pair.Smile
    $referenceImage = [System.Drawing.Image]::FromFile($referencePath)
    $smileImage = [System.Drawing.Image]::FromFile($smilePath)

    $graphics.DrawString($pair.RefLabel, $labelFont, $ink, $leftX, $rowY)
    $graphics.DrawString($pair.SmileLabel, $labelFont, $ink, $rightX, $rowY)
    $graphics.DrawImage($referenceImage, $leftX, $imageY, $imageWidth, $imageHeight)
    $graphics.DrawImage($smileImage, $rightX, $imageY, $imageWidth, $imageHeight)
    $graphics.DrawRectangle($rule, $leftX, $imageY, $imageWidth, $imageHeight)
    $graphics.DrawRectangle($rule, $rightX, $imageY, $imageWidth, $imageHeight)

    $referenceImage.Dispose()
    $smileImage.Dispose()
}

$graphics.DrawString("Reference frames are low-resolution storyboard crops. Smile frames reconstruct the HR flow with demo data; timing is condensed and does not imply screening duration.", $noteFont, $muted, 40, 1360)
$canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$titleFont.Dispose()
$subtitleFont.Dispose()
$labelFont.Dispose()
$noteFont.Dispose()
$rule.Dispose()
$background.Dispose()
$ink.Dispose()
$muted.Dispose()
$graphics.Dispose()
$canvas.Dispose()

Write-Output $outputPath
