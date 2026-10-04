# Builds the Chrome Web Store upload ZIP: only the files the extension runs from.
# Usage:  powershell -ExecutionPolicy Bypass -File package.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$files = @(
  'manifest.json', 'background.js', 'content.js', 'lib.js', 'storage.js',
  'dashboard.html', 'dashboard.js', 'manual.html',
  'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png'
)
$out = Join-Path $PSScriptRoot "hr-stallion-mare-ledger-v$version.zip"
if (Test-Path $out) { Remove-Item $out }
# Written entry by entry so folder paths keep forward slashes (Compress-Archive
# flattens or backslashes them, which breaks the icon paths in the manifest).
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  foreach ($f in $files) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $PSScriptRoot $f), $f) | Out-Null
  }
} finally { $zip.Dispose() }
Write-Host "Packaged $out"
