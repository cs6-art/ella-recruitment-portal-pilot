param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Command,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

$ErrorActionPreference = 'Stop'
$knownFfmpegBin = 'C:\Users\julio\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin'
if ((Test-Path (Join-Path $knownFfmpegBin 'ffmpeg.exe')) -and ($env:PATH -notlike "*$knownFfmpegBin*")) {
  $env:PATH = "$knownFfmpegBin;$env:PATH"
}

& npx --yes hyperframes@0.8.143 $Command @Arguments
exit $LASTEXITCODE
