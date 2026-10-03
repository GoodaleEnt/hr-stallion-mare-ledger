# Builds the Chrome Web Store upload ZIP: only the files the extension runs from.
# Usage:  powershell -ExecutionPolicy Bypass -File package.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$files = @(
  'manifest.json', 'background.js', 'content.js', 'lib.js', 'storage.js',
  'dashboard.html', 'dashboard.js',
  'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png'
)
$out = "hr-stallion-mare-ledger-v$version.zip"
if (Test-Path $out) { Remove-Item $out }
Compress-Archive -Path $files -DestinationPath $out
Write-Host "Packaged $out"
