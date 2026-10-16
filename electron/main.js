// Programa de escritorio de Kiosco Domingo: corre el servidor dentro de la propia PC
// (solo accesible desde esta PC) y lo muestra en una ventana. No necesita Docker ni internet.

const { app, BrowserWindow, ipcMain, clipboard, dialog, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const licencia = require("./licencia");

const RAIZ = path.join(__dirname, "..");
const DIAS_DE_RESPALDO = 30;

// ── Archivos de esta PC: %APPDATA%\Kiosco Domingo\datos ──
// Quedan fuera de la carpeta del programa, así que actualizar o desinstalar no los borra.
const DATOS = path.join(app.getPath("userData"), "datos");
const ARCHIVO = {
  base:      path.join(DATOS, "pos.db"),
  sistema:   path.join(DATOS, "sistema.json"),
  config:    path.join(DATOS, "configuracion.env"),
  licencia:  path.join(DATOS, "licencia.txt"),
  registro:  path.join(DATOS, "registro.log"),
  respaldos: path.join(DATOS, "respaldos"),
};

let ventana = null;

if (!app.requestSingleInstanceLock()) {
  // Ya está abierto: la otra instancia trae su ventana al frente
  app.quit();
} else {
  app.on("second-instance", () => {
    const actual = ventana ?? BrowserWindow.getAllWindows()[0];
    if (actual) {
      if (actual.isMinimized()) actual.restore();
      actual.focus();
    }
  });
  app.whenReady().then(iniciar);
  app.on("window-all-closed", () => app.quit());
}

async function iniciar() {
  try {
    fs.mkdirSync(ARCHIVO.respaldos, { recursive: true });
    if (app.isPackaged) registrarEnArchivo();

    // En desarrollo no se pide licencia, salvo para probarla (KIOSCO_PROBAR_LICENCIA=1)
    const pedirLicencia = app.isPackaged || process.env.KIOSCO_PROBAR_LICENCIA === "1";
    const activacion = pedirLicencia && !licencia.estaActivado(ARCHIVO.licencia) ? await mostrarActivacion() : null;

    configurarEntorno();
    respaldarBase();

    const { applyMigrations } = require(path.join(RAIZ, "dist", "migrate.js"));
    const aplicadas = await applyMigrations(process.env.DATABASE_URL, path.join(RAIZ, "prisma", "migrations"));
    if (aplicadas.length) console.log("Migraciones aplicadas:", aplicadas.join(", "));

    const { startServer } = require(path.join(RAIZ, "dist", "index.js"));
    const puerto = await startServer(0, "127.0.0.1");
    abrirVentana(`http://127.0.0.1:${puerto}`);
    // Recién ahora: si se cerraba antes, el programa quedaba sin ventanas y se cerraba solo
    ventana.once("ready-to-show", () => activacion?.destroy());
  } catch (err) {
    console.error(err);
    dialog.showErrorBox(
      "Kiosco Domingo no pudo iniciar",
      `${err.message}\n\nSi el problema sigue, mandale a soporte el archivo:\n${ARCHIVO.registro}`
    );
    app.exit(1);
  }
}

// Guarda lo que escribe el servidor en registro.log para poder diagnosticar problemas
function registrarEnArchivo() {
  const salida = fs.createWriteStream(ARCHIVO.registro, { flags: "a" });
  for (const nivel of ["log", "warn", "error"]) {
    const original = console[nivel];
    console[nivel] = (...args) => {
      salida.write(`[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" ")}\n`);
      original(...args);
    };
  }
}

// Ventana de activación: se resuelve con la ventana (todavía abierta) cuando el cliente pega una clave válida
function mostrarActivacion() {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 560, height: 680, resizable: false,
      title: "Activar Kiosco Domingo",
      autoHideMenuBar: true,
      backgroundColor: "#f4f0e3",
      icon: path.join(RAIZ, "public", "icon.png"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
    });
    let activado = false;

    ipcMain.handle("licencia:codigo", () => licencia.codigoDeEquipo());
    ipcMain.handle("licencia:copiar", (_e, texto) => clipboard.writeText(String(texto)));
    ipcMain.handle("licencia:activar", (_e, clave) => {
      if (!licencia.activar(ARCHIVO.licencia, clave)) return false;
      activado = true;
      resolve(win);
      return true;
    });

    // Cerrar sin activar = salir del programa
    win.on("closed", () => { if (!activado) app.quit(); });
    win.loadFile(path.join(__dirname, "activacion.html"));
  });
}

function configurarEntorno() {
  // Clave de las sesiones: única por PC, se crea la primera vez
  let sistema = {};
  try { sistema = JSON.parse(fs.readFileSync(ARCHIVO.sistema, "utf8")); } catch {}
  if (!sistema.jwtSecret) {
    sistema.jwtSecret = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(ARCHIVO.sistema, JSON.stringify(sistema, null, 2));
  }

  process.env.JWT_SECRET   = sistema.jwtSecret;
  process.env.DATABASE_URL = "file:" + ARCHIVO.base.replace(/\\/g, "/");
  process.env.HOST         = "127.0.0.1";
  // El administrador se crea desde la pantalla de primer uso, nunca desde variables de entorno
  process.env.ADMIN_USERNAME = "";
  process.env.ADMIN_PASSWORD = "";

  if (app.isPackaged) {
    // El motor de Prisma es nativo: se carga desde la copia fuera del .asar
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(
      process.resourcesPath, "app.asar.unpacked", "dist", "generated", "client", "query_engine-windows.dll.node"
    );
  }

  // Impresora y datos del comercio, editables por el usuario (no pisa lo definido arriba)
  if (!fs.existsSync(ARCHIVO.config)) {
    fs.copyFileSync(path.join(__dirname, "configuracion.ejemplo.env"), ARCHIVO.config);
  }
  require("dotenv").config({ path: ARCHIVO.config });
}

// Una copia de la base por día, antes de abrirla; se conservan las últimas DIAS_DE_RESPALDO
function respaldarBase() {
  if (!fs.existsSync(ARCHIVO.base)) return;
  const hoy = new Date().toLocaleDateString("sv"); // AAAA-MM-DD en hora local
  const destino = path.join(ARCHIVO.respaldos, `pos_${hoy}.db`);
  if (!fs.existsSync(destino)) fs.copyFileSync(ARCHIVO.base, destino);

  const viejos = fs.readdirSync(ARCHIVO.respaldos).filter((f) => /^pos_\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -DIAS_DE_RESPALDO);
  for (const f of viejos) fs.rmSync(path.join(ARCHIVO.respaldos, f));
}

function abrirVentana(url) {
  ventana = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: "Kiosco Domingo",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f4f0e3",
    icon: path.join(RAIZ, "public", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  ventana.once("ready-to-show", () => { ventana.maximize(); ventana.show(); });

  // Los enlaces externos se abren en el navegador; la ventana solo muestra el sistema
  ventana.webContents.setWindowOpenHandler(({ url: destino }) => {
    if (/^https?:\/\//.test(destino)) shell.openExternal(destino);
    return { action: "deny" };
  });
  ventana.webContents.on("will-navigate", (e, destino) => {
    if (new URL(destino).origin !== new URL(url).origin) e.preventDefault();
  });

  ventana.loadURL(url);
}
