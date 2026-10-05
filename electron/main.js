// Processus principal Electron : fenêtre, base de données locale et sauvegardes.
const { app, BrowserWindow, ipcMain, protocol, net, dialog, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { ouvrir, creerApi } = require("./db");

const DEV = process.argv.includes("--dev");
const DOSSIER_UI = path.join(__dirname, "..", "out");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let db, api, fenetre;

function cheminBase() {
  return path.join(app.getPath("userData"), "ecole.db");
}

function dossierSauvegardes() {
  const d = path.join(app.getPath("userData"), "sauvegardes");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function demarrerBase() {
  db = ouvrir(cheminBase());
  api = creerApi(db);
}

function copierBase(destination) {
  if (fs.existsSync(destination)) fs.rmSync(destination);
  db.prepare("VACUUM INTO ?").run(destination);
}

// Une sauvegarde automatique par jour, on garde les 15 plus récentes.
function sauvegardeAutomatique() {
  try {
    const d = dossierSauvegardes();
    const jour = new Date().toISOString().slice(0, 10);
    const fichier = path.join(d, `auto-${jour}.db`);
    if (!fs.existsSync(fichier)) copierBase(fichier);
    const anciens = fs.readdirSync(d).filter((f) => f.startsWith("auto-")).sort().reverse().slice(15);
    for (const f of anciens) fs.rmSync(path.join(d, f));
  } catch (e) {
    console.error("Sauvegarde automatique impossible :", e);
  }
}

// Sert l'interface exportée par Next.js (dossier out/) sous app://ecole/.
function servirInterface() {
  protocol.handle("app", (requete) => {
    let chemin = decodeURIComponent(new URL(requete.url).pathname);
    let fichier = path.normalize(path.join(DOSSIER_UI, chemin));
    if (!fichier.startsWith(DOSSIER_UI)) return new Response("Interdit", { status: 403 });
    if (fs.existsSync(fichier) && fs.statSync(fichier).isDirectory()) fichier = path.join(fichier, "index.html");
    if (!fs.existsSync(fichier)) fichier = path.join(DOSSIER_UI, "404.html");
    return net.fetch(pathToFileURL(fichier).toString());
  });
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: "Gestion Scolaire EPP",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  fenetre.loadURL(DEV ? "http://localhost:3000" : "app://ecole/");
}

function menu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Fichier",
        submenu: [
          { label: "Imprimer…", accelerator: "CmdOrCtrl+P", click: () => fenetre?.webContents.print() },
          { type: "separator" },
          { role: "quit", label: "Quitter" },
        ],
      },
      {
        label: "Affichage",
        submenu: [
          { role: "reload", label: "Actualiser" },
          { role: "zoomIn", label: "Zoom avant" },
          { role: "zoomOut", label: "Zoom arrière" },
          { role: "resetZoom", label: "Taille normale" },
          { role: "togglefullscreen", label: "Plein écran" },
          ...(DEV ? [{ role: "toggleDevTools" }] : []),
        ],
      },
    ])
  );
}

ipcMain.handle("db", (_e, methode, args) => {
  if (!Object.hasOwn(api, methode)) throw new Error(`Méthode inconnue : ${methode}`);
  return api[methode](...(args || []));
});

ipcMain.handle("sauvegarder", async () => {
  const jour = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(fenetre, {
    title: "Enregistrer une sauvegarde",
    defaultPath: `sauvegarde-ecole-${jour}.db`,
    filters: [{ name: "Sauvegarde", extensions: ["db"] }],
  });
  if (canceled || !filePath) return null;
  copierBase(filePath);
  return filePath;
});

ipcMain.handle("restaurer", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(fenetre, {
    title: "Restaurer une sauvegarde",
    defaultPath: dossierSauvegardes(),
    filters: [{ name: "Sauvegarde", extensions: ["db"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return null;
  const source = filePaths[0];
  // Vérifie que le fichier est bien une sauvegarde de cette application.
  try {
    const test = ouvrir(source);
    const ok = test.prepare("SELECT COUNT(*) n FROM ecole").get().n === 1;
    test.close();
    if (!ok) throw new Error();
  } catch {
    throw new Error("Ce fichier n'est pas une sauvegarde valide.");
  }
  // Garde une copie de la base actuelle avant de la remplacer.
  copierBase(path.join(dossierSauvegardes(), `avant-restauration-${Date.now()}.db`));
  db.close();
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(cheminBase() + ext, { force: true });
  fs.copyFileSync(source, cheminBase());
  demarrerBase();
  return source;
});

ipcMain.handle("infos", () => ({
  version: app.getVersion(),
  base: cheminBase(),
  sauvegardes: dossierSauvegardes(),
}));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (fenetre) {
      if (fenetre.isMinimized()) fenetre.restore();
      fenetre.focus();
    }
  });
  app.whenReady().then(() => {
    demarrerBase();
    sauvegardeAutomatique();
    servirInterface();
    menu();
    creerFenetre();
  });
  app.on("window-all-closed", () => {
    db?.close();
    app.quit();
  });
}
