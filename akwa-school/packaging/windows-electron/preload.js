/* Pont entre la page AKWA SCHOOL et Electron : contrat « AkwaNatif » (src/js/data/host.js).
   Aucune API Node n'est exposée à la page. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('AkwaNatif', {
  enregistrerFichier: (nom, base64, mime) => ipcRenderer.invoke('akwa:enregistrerFichier', String(nom), String(base64), String(mime || '')),
  imprimer: (paysage) => ipcRenderer.invoke('akwa:imprimer', !!paysage),
  exporterPdf: (nom, paysage) => ipcRenderer.invoke('akwa:exporterPdf', String(nom), !!paysage),
  version: () => ipcRenderer.sendSync('akwa:version')
});
