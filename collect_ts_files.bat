@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Collect all .ts files recursively into one text file, excluding node_modules.
rem Output file is written next to this .bat file.

set "OUT=%~dp0all-typescript-files.txt"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$root = (Get-Location).ProviderPath;" ^
  "$out = [System.IO.Path]::GetFullPath($env:OUT);" ^
  "if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force };" ^
  "$utf8NoBom = New-Object System.Text.UTF8Encoding($false);" ^
  "$writer = New-Object System.IO.StreamWriter($out, $false, $utf8NoBom);" ^
  "try {" ^
  "  Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.ts' -Force |" ^
  "    Where-Object {" ^
  "      $_.FullName -ne $out -and" ^
  "      -not ($_.FullName -split [regex]::Escape([System.IO.Path]::DirectorySeparatorChar) | Where-Object { $_ -ieq 'node_modules' })" ^
  "    } |" ^
  "    Sort-Object FullName |" ^
  "    ForEach-Object {" ^
  "      $writer.WriteLine('==================================================');" ^
  "      $writer.WriteLine('FILE: ' + $_.FullName);" ^
  "      $writer.WriteLine('==================================================');" ^
  "      $writer.WriteLine();" ^
  "      $reader = New-Object System.IO.StreamReader($_.FullName, [System.Text.Encoding]::UTF8, $true);" ^
  "      try { $writer.Write($reader.ReadToEnd()) } finally { $reader.Close() };" ^
  "      $writer.WriteLine();" ^
  "      $writer.WriteLine();" ^
  "    };" ^
  "} finally { $writer.Close() }"

if errorlevel 1 (
  echo Failed. See the error message above.
  exit /b 1
)

echo Done. Output written to "%OUT%"
endlocal
