; Inno Setup script for RetireCompass. Requires Inno Setup (iscc).
#define AppVersion "1.1.0"
[Setup]
AppName=RetireCompass
AppVersion={#AppVersion}
AppPublisher=Rajeev Yadav
DefaultDirName={autopf}\RetireCompass
DefaultGroupName=RetireCompass
OutputDir=..\dist
OutputBaseFilename=RetireCompass-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
[Files]
; One-folder PyInstaller build: package the whole dist\RetireCompass tree
; (RetireCompass.exe plus its _internal runtime folder), not a single file.
Source: "..\dist\RetireCompass\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\RetireCompass"; Filename: "{app}\RetireCompass.exe"
Name: "{commondesktop}\RetireCompass"; Filename: "{app}\RetireCompass.exe"
[Run]
Filename: "{app}\RetireCompass.exe"; Description: "Launch RetireCompass"; Flags: nowait postinstall skipifsilent
