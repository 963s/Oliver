import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("orElectron", {
  getPaths:           () => ipcRenderer.invoke("or:getPaths"),
  checkForUpdate:     () => ipcRenderer.invoke("or:checkForUpdate"),
  getPendingUpdate:   () => ipcRenderer.invoke("or:getPendingUpdate"),
  getUpdateStatus:    () => ipcRenderer.invoke("or:getUpdateStatus"),
  openUpdatePage:     (url) => ipcRenderer.invoke("or:openUpdatePage", url),
  installUpdate:      () => ipcRenderer.invoke("or:installUpdate"),
  onUpdateAvailable:  (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("update-available", handler);
    return () => ipcRenderer.removeListener("update-available", handler);
  },
  onUpdateCheckComplete: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("update-check-complete", handler);
    return () => ipcRenderer.removeListener("update-check-complete", handler);
  },
  onUpdateProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("update-progress", handler);
    return () => ipcRenderer.removeListener("update-progress", handler);
  },
});
