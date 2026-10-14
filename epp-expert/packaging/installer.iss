; Inno Setup 6 : ISCC.exe packaging\installer.iss  (après PyInstaller)
; Les données de l'école (%LOCALAPPDATA%\GestionScolaireEPP) ne sont JAMAIS dans le dossier
; d'installation : une mise à jour ou une désinstallation les conserve, sauf demande explicite.
#define AppName "AKWA SCHOOL"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppExe "GestionScolaireEPP.exe"

[Setup]
AppId={{ACBCABBC-CCDC-4F43-B7B7-5DE0CB65CD13}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=NGATTA
DefaultDirName={autopf}\GestionScolaireEPP
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UsePreviousGroup=no
OutputDir=..\dist
OutputBaseFilename=AkwaSchool-Setup-{#AppVersion}
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
Source: "..\dist\GestionScolaireEPP\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; raccourcis de l'ancien nom (GESTION SCOLAIRE EPP EXPERT), remplacés par AKWA SCHOOL lors d'une mise à jour
Type: files; Name: "{autodesktop}\GESTION SCOLAIRE EPP EXPERT.lnk"
Type: filesandordirs; Name: "{autoprograms}\GESTION SCOLAIRE EPP EXPERT"

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
    DelTree(ExpandConstant('{localappdata}\GestionScolaireEPP'), True, True, True);
end;
