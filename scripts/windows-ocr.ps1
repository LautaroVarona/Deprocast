param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = $null
foreach ($m in [System.WindowsRuntimeSystemExtensions].GetMethods()) {
  if ($m.Name -ne 'AsTask') { continue }
  $ps = $m.GetParameters()
  if ($ps.Count -eq 1 -and $ps[0].ParameterType.Name -eq 'IAsyncOperation`1') {
    $asTaskGeneric = $m
    break
  }
}
if (-not $asTaskGeneric) {
  throw 'WinRT AsTask no disponible en este PowerShell'
}

function Await-WinRT($WinRtTask, [Type]$ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  if (-not $netTask.Wait(60000)) { throw 'Windows OCR timeout' }
  if ($netTask.IsFaulted) { throw $netTask.Exception.GetBaseException() }
  return $netTask.Result
}

$resolved = (Resolve-Path -LiteralPath $ImagePath).Path

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$engine = $null
foreach ($tag in @('es-ES', 'es-MX', 'es', 'en-US', 'en')) {
  try {
    $lang = New-Object Windows.Globalization.Language $tag
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
    if ($engine) { break }
  } catch { }
}
if (-not $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if (-not $engine) {
  throw 'Windows OCR no disponible (paquete de idioma OCR)'
}

$file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])
$stream = Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
  $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $bgra = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert(
    $bitmap,
    [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
    [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied
  )
  $result = Await-WinRT ($engine.RecognizeAsync($bgra)) ([Windows.Media.Ocr.OcrResult])
  if ($result.Text) {
    [Console]::Out.Write($result.Text)
  }
} finally {
  if ($stream) { $stream.Dispose() }
}
