; FaceSwap вЂ” СѓСЃС‚Р°РЅРѕРІС‰РёРє (Inno Setup 7)
; Per-user СѓСЃС‚Р°РЅРѕРІРєР° РІ {localappdata}\Programs\FaceSwap вЂ” Р±РµР· РїСЂР°РІ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°.
; РљРѕРјРїРѕРЅРµРЅС‚ "comfyui" вЂ” РІРµСЃСЊ portable ComfyUI (С‚РѕР»СЊРєРѕ РґР»СЏ СЂРµР»РёР·РЅРѕР№ СЃР±РѕСЂРєРё):
;   iscc faceswap.iss /DCOMFYUI_SOURCE="Z:\Comfy\ComfyUI_windows_portable"

#define MyAppName "FaceSwap"
#define MyAppVersion "1.1.0"
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
; Р‘РµР· UAC: СЃС‚Р°РІРёС‚СЃСЏ РІ РїСЂРѕС„РёР»СЊ С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
#ifdef OUTDIR
OutputDir={#OUTDIR}
#else
OutputDir=..\dist-installer
#endif
OutputBaseFilename=FaceSwap-Setup-{#MyAppVersion}
; РњРѕРґРµР»Рё Flux2 (~19 Р“Р‘) РґРµР»Р°СЋС‚ СѓСЃС‚Р°РЅРѕРІС‰РёРє Р±РѕР»СЊС€Рµ 4 Р“Р‘ вЂ” РІРєР»СЋС‡Р°РµРј spanning:
; Setup.exe РЅРµР±РѕР»СЊС€РѕР№, РґР°РЅРЅС‹Рµ РёРґСѓС‚ РІ .bin-С‚РѕРјР° РїРѕ ~2 Р“Р‘ (Р»РёРјРёС‚ GitHub Releases)
DiskSpanning=yes
DiskSliceSize=2000000000
SlicesPerDisk=1
; FASTBUILD вЂ” Р±С‹СЃС‚СЂРѕРµ СЃР¶Р°С‚РёРµ РґР»СЏ С‚РµСЃС‚РѕРІС‹С… СЃР±РѕСЂРѕРє СЃ Р±РѕР»СЊС€РёРј РєРѕРјРїРѕРЅРµРЅС‚РѕРј comfyui
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
Name: "desktopicon"; Description: "РЎРѕР·РґР°С‚СЊ СЏСЂР»С‹Рє РЅР° СЂР°Р±РѕС‡РµРј СЃС‚РѕР»Рµ"; GroupDescription: "Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Рµ Р·Р°РґР°С‡Рё:"

[Files]
; РСЃРїРѕР»РЅСЏРµРјС‹Р№ С„Р°Р№Р» РѕР±РѕР»РѕС‡РєРё (Tauri)
Source: "..\src-tauri\target\release\FaceSwap.exe"; DestDir: "{app}"; Flags: ignoreversion
; Node runtime вЂ” СЃР°Р№РґРєР°СЂ СЃРµСЂРІРµСЂР°
Source: "..\sidecar\node.exe"; DestDir: "{app}"; Flags: ignoreversion
; Р’РµР±-РёРЅС‚РµСЂС„РµР№СЃ Рё СЃРµСЂРІРµСЂ
Source: "..\dist-web\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\server.js"; DestDir: "{app}\resources"; Flags: ignoreversion
; ComfyUI portable (СЂРµР»РёР·РЅР°СЏ СЃР±РѕСЂРєР° "РёР· РєРѕСЂРѕР±РєРё") вЂ” Р±РµР· РєРѕРјРїРѕРЅРµРЅС‚РЅРѕРіРѕ СЂР°Р·РґРµР»РµРЅРёСЏ,
; РІСЃС‘ СЃС‚Р°РІРёС‚СЃСЏ РІСЃРµРіРґР° (СЂРµС€РµРЅРёРµ: ComfyUI Р·Р°С€РёС‚ РІ СѓСЃС‚Р°РЅРѕРІС‰РёРє С†РµР»РёРєРѕРј)
#ifdef COMFYUI_SOURCE
Source: "{#COMFYUI_SOURCE}\*"; DestDir: "{app}\resources\comfyui"; Flags: ignoreversion recursesubdirs createallsubdirs
#endif

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "Р—Р°РїСѓСЃС‚РёС‚СЊ FaceSwap"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; РџРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёРµ РґР°РЅРЅС‹Рµ РќР• СѓРґР°Р»СЏРµРј: СЂРµР·СѓР»СЊС‚Р°С‚С‹ Рё Р·Р°РіСЂСѓР·РєРё РѕСЃС‚Р°СЋС‚СЃСЏ РІ %LOCALAPPDATA%\FaceSwap\data
