// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ecole", {
  db: (methode, ...args) => ipcRenderer.invoke("db", methode, args),
  sauvegarder: () => ipcRenderer.invoke("sauvegarder"),
  restaurer: () => ipcRenderer.invoke("restaurer"),
  infos: () => ipcRenderer.invoke("infos"),
});
