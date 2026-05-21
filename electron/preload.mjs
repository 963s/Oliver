import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("orElectron", {
  getPaths: () => ipcRenderer.invoke("or:getPaths"),
  checkForUpdate: () => ipcRenderer.invoke("or:checkForUpdate"),
  openUpdatePage: (url) => ipcRenderer.invoke("or:openUpdatePage", url),
  onUpdateAvailable: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("update-available", handler);
    return () => ipcRenderer.removeListener("update-available", handler);
  },
});
