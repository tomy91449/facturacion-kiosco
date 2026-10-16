// Puente mínimo entre la ventana de activación y el proceso principal
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("licencia", {
  codigo:  ()      => ipcRenderer.invoke("licencia:codigo"),
  activar: (clave) => ipcRenderer.invoke("licencia:activar", clave),
  copiar:  (texto) => ipcRenderer.invoke("licencia:copiar", texto),
});
