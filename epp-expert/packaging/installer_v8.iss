; Inno Setup 6 : ISCC.exe packaging\installer_v8.iss  (après pyinstaller packaging/akwa_v8.spec)
; AKWA SCHOOL v8 : application distincte d'AKWA SCHOOL (autre dossier, autres raccourcis, données à part dans
; %LOCALAPPDATA%\GestionScolaireEPP\akwa_v8). La licence de l'ordinateur est commune aux deux applications.
; Les données de l'école (%LOCALAPPDATA%\GestionScolaireEPP) ne sont JAMAIS dans le dossier
; d'installation : une mise à jour ou une désinstallation les conserve, sauf demande explicite.
#define AppName "AKWA SCHOOL v8"
#ifndef AppVersion
  #define AppVersion "1.3.0"
#endif
#define AppExe "AkwaSchoolV8.exe"

[Setup]
AppId={{6F1D2B7E-3A49-4C8B-9E21-7D5A0C4E8B13}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=NGATTA
DefaultDirName={autopf}\AkwaSchoolV8
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UsePreviousGroup=no
OutputDir=..\dist
OutputBaseFilename=AkwaSchool-v8-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
SetupIconFile=..\epp\resources\app.ico
UninstallDisplayIcon={app}\{#AppExe}
CloseApplications=yes

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"

[Files]
Source: "..\dist\AkwaSchoolV8\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Désinstaller {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Lancer {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
var SupprimerDonnees: Boolean;

function InitializeUninstall(): Boolean;
begin
  SupprimerDonnees := False;
  if not UninstallSilent then
    SupprimerDonnees := MsgBox('Voulez-vous aussi SUPPRIMER DÉFINITIVEMENT les données de l''école ' +
      '(élèves, notes, sauvegardes) ?' #13#10#13#10 + 'Répondez NON pour les conserver (recommandé).',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and SupprimerDonnees then
    DelTree(ExpandConstant('{localappdata}\GestionScolaireEPP\akwa_v8'), True, True, True);
end;
