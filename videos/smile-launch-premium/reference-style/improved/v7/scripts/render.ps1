param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RenderOptions
)

if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -or
    -not (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)) {
  $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  $ffmpegPackage = Get-ChildItem -LiteralPath $wingetPackages -Directory -Filter 'Gyan.FFmpeg*' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($ffmpegPackage) {
    $ffmpegBuild = Get-ChildItem -LiteralPath $ffmpegPackage.FullName -Directory -Filter 'ffmpeg*full_build' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($ffmpegBuild) {
      $ffmpegBin = Join-Path $ffmpegBuild.FullName 'bin'
      if (Test-Path (Join-Path $ffmpegBin 'ffmpeg.exe')) {
        $env:PATH = "$ffmpegBin;$env:PATH"
      }
    }
  }
}

if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -or
    -not (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)) {
  Write-Error 'HyperFrames rendering requires FFmpeg and FFprobe. Install FFmpeg or add its bin directory to PATH.'
  exit 1
}

$hyperFramesArgs = @('render') + $RenderOptions
& npx --yes hyperframes@0.8.143 @hyperFramesArgs
exit $LASTEXITCODE
