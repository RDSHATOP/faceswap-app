; FaceSwap — установщик (Inno Setup 7)
; Per-user установка в {localappdata}\Programs\FaceSwap — без прав администратора.
; Компонент "comfyui" — весь portable ComfyUI (только для релизной сборки):
;   iscc faceswap.iss /DCOMFYUI_SOURCE="Z:\Comfy\ComfyUI_windows_portable"

#define MyAppName "FaceSwap"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Zaloopa"
#define MyAppExe "FaceSwap.exe"

[Setup]
AppId={{7B3E2C91-9D44-4F0A-BE35-9C2E8F6A1D20}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\FaceSwap
DefaultGroupName=FaceSwap
DisableProgramGroupPage=yes
; Без UAC: ставится в профиль текущего пользователя
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
#ifdef OUTDIR
OutputDir={#OUTDIR}
#else
OutputDir=..\dist-installer
#endif
OutputBaseFilename=FaceSwap-Setup-{#MyAppVersion}
; Модели Flux2 (~19 ГБ) делают установщик больше 4 ГБ — включаем spanning:
; Setup.exe небольшой, данные идут в .bin-тома по ~2 ГБ (лимит GitHub Releases)
DiskSpanning=yes
DiskSliceSize=2000000000
SlicesPerDisk=1
; FASTBUILD — быстрое сжатие для тестовых сборок с большим компонентом comfyui
#ifdef FASTBUILD
Compression=lzma2/fast
#else
Compression=lzma2/ultra64
#endif
SolidCompression=yes
SetupIconFile=..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\{#MyAppExe}
UninstallDisplayName={#MyAppName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DirExistsWarning=no
CloseApplications=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные задачи:"

[Files]
; Исполняемый файл оболочки (Tauri)
Source: "..\src-tauri\target\release\FaceSwap.exe"; DestDir: "{app}"; Flags: ignoreversion
; Node runtime — сайдкар сервера
Source: "..\sidecar\node.exe"; DestDir: "{app}"; Flags: ignoreversion
; Веб-интерфейс и сервер
Source: "..\dist-web\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\server.js"; DestDir: "{app}\resources"; Flags: ignoreversion
; ComfyUI portable (релизная сборка "из коробки") — без компонентного разделения,
; всё ставится всегда (решение: ComfyUI зашит в установщик целиком)
#ifdef COMFYUI_SOURCE
Source: "{#COMFYUI_SOURCE}\*"; DestDir: "{app}\resources\comfyui"; Flags: ignoreversion recursesubdirs createallsubdirs
#endif

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "Запустить FaceSwap"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Пользовательские данные НЕ удаляем: результаты и загрузки остаются в %LOCALAPPDATA%\FaceSwap\data
