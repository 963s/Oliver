import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("orElectron", {
  getPaths: () => ipcRenderer.invoke("or:getPaths"),
});
