/* =====================================================================================
   AKWA SCHOOL 2 — emballage Windows (.exe) avec Electron.
   Charge le fichier unique app/AKWA_SCHOOL.html (copié depuis dist/) et expose à la page le
   contrat « AkwaNatif » (voir src/js/data/host.js) par preload.js :
     enregistrerFichier(nom, base64, mime) → boîte « Enregistrer sous » de Windows
     imprimer(paysage)                     → impression Windows (aperçu du pilote)
     exporterPdf(nom, paysage)             → VRAI fichier PDF (printToPDF, formats @page respectés)
     version()                             → version de l'application
   Données : IndexedDB dans le profil de l'application (%APPDATA%\AKWA SCHOOL), conservées
   lors des mises à jour. Aucune connexion Internet n'est utilisée.
   Construit et auto-testé par la CI GitHub (.github/workflows/akwa-school-2.yml) : l'option
   --auto-test=<fichier.json> ouvre la page sans l'afficher, vérifie le démarrage et le contrat
   AkwaNatif, produit un PDF avec printToPDF, écrit le résultat puis quitte (code 0 si tout va bien).
   ===================================================================================== */
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const PAGE = path.join(__dirname, 'app', 'AKWA_SCHOOL.html');
const AUTO_TEST = (process.argv.find((a) => a.startsWith('--auto-test=')) || '').slice('--auto-test='.length);
let fenetre = null;

// une seule fenêtre : deux instances écriraient dans la même base IndexedDB
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (fenetre) {
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.focus();
  }
});

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1366, height: 860, minWidth: 380, minHeight: 560, show: false,
    title: 'AKWA SCHOOL', backgroundColor: '#f4f2ed', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  fenetre.removeMenu();
  if (AUTO_TEST) fenetre.webContents.once('did-finish-load', autoTest);
  else fenetre.once('ready-to-show', () => fenetre.show());
  // la page ne quitte jamais l'application : les liens externes (tel:, sms:, mailto:, https:) vont au système
  fenetre.webContents.on('will-navigate', (e, url) => {
    if (url !== fenetre.webContents.getURL() && !url.startsWith('file://' + PAGE.replace(/\\/g, '/'))) {
      e.preventDefault();
      if (/^(https?:|mailto:|tel:|sms:)/.test(url)) shell.openExternal(url);
    }
  });
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:|tel:|sms:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // fermeture : la page demande confirmation s'il reste une modification non enregistrée (beforeunload)
  fenetre.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(fenetre, { type: 'warning', buttons: ['Rester', 'Quitter quand même'], defaultId: 0, cancelId: 0, title: 'AKWA SCHOOL', message: 'Des modifications sont en cours d’enregistrement.', detail: 'Patientez une seconde puis fermez de nouveau.' });
    if (r === 1) e.preventDefault();
  });
  fenetre.loadFile(PAGE);
}

/** Auto-test de l'exécutable construit (CI) : démarrage de la page, hôte « natif », vrai PDF. */
async function autoTest() {
  const r = { ok: false };
  try {
    r.page = await fenetre.webContents.executeJavaScript(`new Promise((ok) => {
      let n = 0;
      const t = setInterval(() => {
        const pret = !!(window.AK && document.querySelector('[data-ep]'));
        if (pret || ++n > 150) {
          clearInterval(t);
          ok({ pret, hote: window.AK && AK.hote && AK.hote.type, version: window.AK && AK.VERSION, natif: typeof window.AkwaNatif, stockage: window.AK && AK.stockage && AK.stockage.actif && AK.stockage.actif.nom });
        }
      }, 100);
    })`);
    const pdf = await fenetre.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    r.pdfOctets = pdf.length;
    r.pdfSignature = pdf.subarray(0, 5).toString('latin1');
    r.ok = r.page.pret && r.page.hote === 'natif' && r.pdfSignature === '%PDF-' && pdf.length > 1000;
  } catch (e) {
    r.erreur = String((e && e.message) || e);
  }
  await fs.writeFile(AUTO_TEST, JSON.stringify(r, null, 1));
  app.exit(r.ok ? 0 : 1);
}

app.whenReady().then(() => {
  // caméra autorisée (lecture des QR codes) ; tout le reste refusé
  session.defaultSession.setPermissionRequestHandler((wc, permission, rappel, details) => {
    rappel(permission === 'media' && (!details.mediaTypes || details.mediaTypes.every((t) => t === 'video')));
  });
  creerFenetre();
});
app.on('window-all-closed', () => app.quit());

/* ---------- Contrat AkwaNatif ---------- */
const FILTRES = { 'application/json': ['json'], 'text/csv': ['csv'], 'text/html': ['html'], 'application/pdf': ['pdf'], 'text/plain': ['txt'] };
async function demanderChemin(nom, mime) {
  const ext = (FILTRES[String(mime).split(';')[0]] || [path.extname(nom).slice(1) || '*'])[0];
  const r = await dialog.showSaveDialog(fenetre, { defaultPath: path.join(app.getPath('documents'), nom), filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
  return r.canceled || !r.filePath ? '' : r.filePath;
}
ipcMain.handle('akwa:enregistrerFichier', async (e, nom, b64, mime) => {
  const chemin = await demanderChemin(String(nom), mime);
  if (!chemin) return '';
  await fs.writeFile(chemin, Buffer.from(String(b64), 'base64'));
  return chemin;
});
ipcMain.handle('akwa:imprimer', (e, paysage) => new Promise((ok) => {
  e.sender.print({ silent: false, printBackground: true, landscape: !!paysage }, (reussi, raison) => ok(reussi ? '' : raison || ''));
}));
ipcMain.handle('akwa:exporterPdf', async (e, nom, paysage) => {
  const chemin = await demanderChemin(String(nom), 'application/pdf');
  if (!chemin) return '';
  // preferCSSPageSize : les formats déclarés par la page (@page A4, A5, cartes) sont respectés
  const pdf = await e.sender.printToPDF({ printBackground: true, landscape: !!paysage, preferCSSPageSize: true, margins: { marginType: 'none' } });
  await fs.writeFile(chemin, pdf);
  return chemin;
});
ipcMain.on('akwa:version', (e) => (e.returnValue = app.getVersion()));
