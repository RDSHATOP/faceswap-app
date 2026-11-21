# FaceSwap — релизный скрипт
# Собирает установщик, раскладывает на части (<2 ГБ для GitHub), считает хэши,
# коммитит и тегирует; с -Publish создаёт GitHub Release.
#
# Пример:
#   powershell -File scripts/release.ps1 -Version 1.1.0
#   powershell -File scripts/release.ps1 -Version 1.1.0 -Publish -Repo dimak/faceswap-app

param(
  [Parameter(Mandatory = $true)][string]$Version,          # X.Y.Z
  [switch]$SkipBuild,                                      # не пересобирать exe/установщик
  [string]$ComfySource = "Z:\faceswap-staging\portable",   # staging ComfyUI
  [string]$OutDir = "Z:\FaceSwap-dist",                    # куда класть артефакты
  [string]$Repo = "RDSHATOP/faceswap-app",                                      # owner/repo для -Publish
  [switch]$Publish                                         # создать GitHub Release
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$SetupName = "FaceSwap-Setup-$Version.exe"
$GhPath = "C:\Users\dimak\OneDrive\Рабочий стол\Zaloopa\installers-prereq\gh-cli\bin\gh.exe"
$Iscc = "C:\Program Files\Inno Setup 7\ISCC.exe"
$MaxPart = 1900MB

function Die($msg) { Write-Error $msg; exit 1 }

# ---------- 1. Версии в файлах проекта ----------
Write-Host "==> Версия $Version"
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Die "Версия должна быть в формате X.Y.Z" }

$pkg = Get-Content "$Root\package.json" -Raw | ConvertFrom-Json
if ($pkg.version -ne $Version) {
  (Get-Content "$Root\package.json" -Raw) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" | Set-Content "$Root\package.json" -NoNewline
}
(Get-Content "$Root\src-tauri\Cargo.toml" -Raw) -replace '(?m)^version = "[^"]+"', "version = `"$Version`"" | Set-Content "$Root\src-tauri\Cargo.toml" -NoNewline
(Get-Content "$Root\src-tauri\tauri.conf.json" -Raw) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" | Set-Content "$Root\src-tauri\tauri.conf.json" -NoNewline
(Get-Content "$Root\installer\faceswap.iss" -Raw) -replace '#define MyAppVersion "[^"]+"', "#define MyAppVersion `"$Version`"" | Set-Content "$Root\installer\faceswap.iss" -NoNewline -Encoding UTF8

# ---------- 2. Сборка ----------
if (-not $SkipBuild) {
  Write-Host "==> Собираю веб-ресурсы"
  node "$Root\scripts\build-web.js"

  Write-Host "==> Собираю FaceSwap.exe (cargo, долго)"
  Push-Location "$Root\src-tauri"
  cargo build --release
  if ($LASTEXITCODE -ne 0) { Pop-Location; Die "cargo build завершился с кодом $LASTEXITCODE" }
  Pop-Location

  if (-not (Test-Path "$Root\sidecar\node.exe")) {
    Write-Host "==> Скачиваю node.exe для сайдкара"
    Invoke-WebRequest "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip" -OutFile "$env:TEMP\node.zip"
    Expand-Archive "$env:TEMP\node.zip" "$env:TEMP\node-portable" -Force
    Copy-Item "$env:TEMP\node-portable\node-v24.21.0-win-x64\node.exe" "$Root\sidecar\node.exe" -Force
  }

  Write-Host "==> Собираю установщик (Inno Setup, долго при большом comfyui)"
  & $Iscc "$Root\installer\faceswap.iss" /DCOMFYUI_SOURCE="$ComfySource" /DFASTBUILD /DOUTDIR="$OutDir" | Select-Object -Last 5
  if ($LASTEXITCODE -ne 0) { Die "ISCC завершился с кодом $LASTEXITCODE" }
}

$setup = Join-Path $OutDir $SetupName
if (-not (Test-Path $setup)) { Die "Не найден установщик: $setup" }

# ---------- 3. Разбивка на части (<2 ГБ на файл для GitHub Releases) ----------
$setupItem = Get-Item $setup
$parts = @()
if ($setupItem.Length -gt $MaxPart) {
  Write-Host "==> Разбиваю установщик на части по $([math]::Round($MaxPart/1MB)) МБ"
  Remove-Item "$OutDir\$SetupName.part*" -Force -ErrorAction SilentlyContinue
  $src = [System.IO.File]::OpenRead($setup)
  $n = 0
  try {
    $buf = New-Object byte[] (16MB)
    while ($true) {
      $target = New-Object System.IO.FileStream("$OutDir\$SetupName.part$($n+1)", 'Create')
      try {
        $written = 0L
        while ($written -lt $MaxPart) {
          $read = $src.Read($buf, 0, [math]::Min($buf.Length, $MaxPart - $written))
          if ($read -le 0) { break }
          $target.Write($buf, 0, $read)
          $written += $read
        }
      } finally { $target.Dispose() }
      $n++
      if ($src.Position -ge $src.Length) { break }
    }
  } finally { $src.Dispose() }
  for ($i = 1; $i -le $n; $i++) { $parts += "$OutDir\$SetupName.part$i" }

  # JOIN.cmd — склеивает части и запускает установщик (ASCII-только текст!)
  $copyLine = "copy /b `"$SetupName.part1`""
  for ($i = 2; $i -le $n; $i++) { $copyLine += " + `"$SetupName.part$i`"" }
  $copyLine += " `"$SetupName`""
  $join = @("@echo off", "cd /d %~dp0",
    "echo Joining installer parts...",
    $copyLine,
    "if errorlevel 1 (echo ERROR: not all parts downloaded & pause & exit /b 1)",
    "start `"`" `"$SetupName`"",
    "del /q `"%~nx0`"")
  ($join -join "`r`n") | Out-File "$OutDir\JOIN.cmd" -Encoding ascii
  Write-Host "    частей: $n"
} else {
  $parts += $setup
}

# Inno disk spanning: данные (>4 ГБ) идут в .bin-томах рядом с Setup.exe
$bins = @(Get-ChildItem "$OutDir\$SetupName-*.bin" -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { $_.FullName })
if ($bins.Count -gt 0) {
  Write-Host "    томов установщика (Inno spanning): $($bins.Count)"
  $parts += $bins
}

# ---------- 4. Контрольные суммы ----------
Write-Host "==> Считаю SHA-256"
$lines = @()
foreach ($f in $parts) {
  $h = (Get-FileHash $f -Algorithm SHA256).Hash
  $lines += "$h  $([IO.Path]::GetFileName($f))"
  Write-Host "    $h  $(Split-Path $f -Leaf)"
}
if ($setupItem.Length -gt $MaxPart) {
  $h = (Get-FileHash $setup -Algorithm SHA256).Hash
  $lines += "$h  $SetupName (after join)"
}
$lines | Out-File "$OutDir\SHA256SUMS.txt" -Encoding ascii

# ---------- 5. Коммит и тег ----------
Push-Location $Root
git add -A
git commit -m "Release $Version" | Out-Null
git tag -f "v$Version"
Pop-Location
Write-Host "==> Тег v$Version создан (локально)"

# ---------- 6. Публикация ----------
if ($Publish) {
  if (-not $Repo) { Die "Для -Publish укажите -Repo owner/repo" }
  if (-not (Test-Path $GhPath)) { Die "Не найден gh: $GhPath" }
  Write-Host "==> Публикую релиз v$Version на github.com/$Repo"
  $assets = $parts + "$OutDir\SHA256SUMS.txt"
  if (Test-Path "$OutDir\JOIN.cmd") { $assets += "$OutDir\JOIN.cmd" }
  & $GhPath release create "v$Version" --repo $Repo --title "FaceSwap $Version" --notes "FaceSwap $Version — установщик для Windows (x64)." $assets
  if ($LASTEXITCODE -ne 0) { Die "gh release create завершился с кодом $LASTEXITCODE" }
  Write-Host "==> Релиз опубликован: https://github.com/$Repo/releases/tag/v$Version"
} else {
  Write-Host "==> Готово. Для публикации: -Publish -Repo owner/repo"
}
