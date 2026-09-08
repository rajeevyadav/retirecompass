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
Source: "..\dist\RetireCompass.exe"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{group}\RetireCompass"; Filename: "{app}\RetireCompass.exe"
Name: "{commondesktop}\RetireCompass"; Filename: "{app}\RetireCompass.exe"
[Run]
Filename: "{app}\RetireCompass.exe"; Description: "Launch RetireCompass"; Flags: nowait postinstall skipifsilent
