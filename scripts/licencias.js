// Herramienta del vendedor para las licencias de Kiosco Domingo. NO va dentro del instalador.
//
//   node scripts/licencias.js crear-claves
//       Una sola vez. Crea el par de claves: la privada queda en tu carpeta de usuario
//       (KioscoDomingo-licencias) y la pública en electron/clave-publica.pem.
//
//   node scripts/licencias.js KD-XXXX-XXXX-XXXX "Nombre del cliente"
//       Genera la clave de activación para el código que te mandó el cliente
//       y la anota en registro.csv.
//
// Si perdés la clave privada no vas a poder activar más clientes con los instaladores ya
// entregados: guardá una copia de la carpeta KioscoDomingo-licencias fuera de esta PC.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Tiene que coincidir con electron/licencia.js
const PREFIJO_FIRMA = "kiosco-domingo:v1:";

const carpetaPrivada = path.join(os.homedir(), "KioscoDomingo-licencias");
const archivoPrivado = path.join(carpetaPrivada, "clave-privada.pem");
const archivoRegistro = path.join(carpetaPrivada, "registro.csv");
const archivoPublico = path.join(__dirname, "..", "electron", "clave-publica.pem");

function salir(mensaje) {
  console.error("ERROR: " + mensaje);
  process.exit(1);
}

function crearClaves() {
  if (fs.existsSync(archivoPrivado)) {
    salir(`Ya existe ${archivoPrivado}. No se pisa: los clientes ya activados dejarían de coincidir.`);
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(carpetaPrivada, { recursive: true });
  fs.writeFileSync(archivoPrivado, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(archivoPublico, publicKey.export({ type: "spki", format: "pem" }));
  fs.writeFileSync(archivoRegistro, "fecha,codigo,cliente,clave\n");
  console.log("Claves creadas.");
  console.log("  Privada (solo vos, hacé una copia de respaldo): " + archivoPrivado);
  console.log("  Pública (va en el instalador):                   " + archivoPublico);
}

function generarLicencia(codigo, cliente) {
  codigo = String(codigo).trim().toUpperCase();
  if (!/^KD-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(codigo)) {
    salir("El código tiene que tener la forma KD-XXXX-XXXX-XXXX (lo muestra el programa al abrirlo).");
  }
  if (!fs.existsSync(archivoPrivado)) {
    salir(`No está la clave privada (${archivoPrivado}). Si es la primera vez: node scripts/licencias.js crear-claves`);
  }
  const clavePrivada = crypto.createPrivateKey(fs.readFileSync(archivoPrivado));
  const clave = crypto.sign(null, Buffer.from(PREFIJO_FIRMA + codigo), clavePrivada).toString("base64url");

  const nombre = String(cliente || "").replace(/[",\r\n]/g, " ").trim();
  fs.appendFileSync(archivoRegistro, `${new Date().toISOString()},${codigo},"${nombre}",${clave}\n`);

  console.log(`\nClave de activación para ${codigo}${nombre ? " (" + nombre + ")" : ""}:\n`);
  console.log(clave + "\n");
  console.log("Mandásela al cliente: la pega en la pantalla de activación.");
}

const [comando, cliente] = process.argv.slice(2);
if (comando === "crear-claves") crearClaves();
else if (comando) generarLicencia(comando, cliente);
else salir('Uso: node scripts/licencias.js crear-claves   |   node scripts/licencias.js KD-XXXX-XXXX-XXXX "Cliente"');
