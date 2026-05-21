const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const isPackaged = app.isPackaged;

// 1. Cargar entorno seguro
const envPath = isPackaged 
  ? path.join(process.resourcesPath, ".env") 
  : path.join(__dirname, ".env");
require("dotenv").config({ path: envPath });

process.env.PORT = "4000";

// 2. Configurar Base de Datos SQLite
const dbDir = isPackaged 
  ? path.join(app.getPath("userData"), "prisma") 
  : path.join(__dirname, "prisma");

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Sincronizamos con la ruta que espera Prisma en desarrollo
const dbPath = path.join(dbDir, "pos.db");
process.env.DATABASE_URL = `file:${dbPath}`;

// 3. Motor de Prisma
const queryEngineName = "query_engine-windows.dll.node";
process.env.PRISMA_QUERY_ENGINE_LIBRARY = isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked", "src", "generated", "client", queryEngineName)
  : path.resolve(__dirname, "src", "generated", "client", queryEngineName);

// 4. Intentar levantar backend de forma aislada
const backendPath = isPackaged ? path.join(__dirname, "dist", "index.js") : "./dist/index.js";

try {
  console.log("⏳ Cargando componentes del servidor...");
  require(backendPath);
  console.log("✅ Servidor inicializado.");
} catch (error) {
  // Si falla el backend, lo mostramos pero NO matamos a Electron
  console.error("⚠️ Alerta en el Backend (revisar Prisma/Express):", error.message);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Kiosco Domingo",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    backgroundColor: "#f7f5f0",
  });

  mainWindow.loadURL("http://localhost:4000");

  // Abrir herramientas por si el puerto 4000 está caído y ver el motivo en la ventana
  if (!isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  setTimeout(createWindow, 1500); // 1.5 segundos de gracia para que cargue
});

app.on("window-all-closed", () => {
  app.quit();
});