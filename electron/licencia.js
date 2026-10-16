// Licencia por PC: cada equipo tiene un código propio y la clave de activación es la firma
// (Ed25519) de ese código con la clave privada que solo tiene el vendedor.
// Las claves se generan con scripts/licencias.js.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Tiene que coincidir con scripts/licencias.js
const PREFIJO_FIRMA = "kiosco-domingo:v1:";
const clavePublica = crypto.createPublicKey(fs.readFileSync(path.join(__dirname, "clave-publica.pem")));

// Identificador de la instalación de Windows: no cambia al reiniciar ni al actualizar el programa
function leerIdWindows() {
  const salida = execFileSync(
    "reg",
    ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"],
    { encoding: "utf8", windowsHide: true }
  );
  const id = salida.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
  if (!id) throw new Error("No se pudo identificar este equipo");
  return id[1].toLowerCase();
}

let codigoEnCache = null;

/** Código que el cliente le manda al vendedor, ej: KD-7F3A-91C2-04BE */
function codigoDeEquipo() {
  if (!codigoEnCache) {
    const hex = crypto.createHash("sha256").update("kiosco-domingo|" + leerIdWindows()).digest("hex").slice(0, 12).toUpperCase();
    codigoEnCache = "KD-" + hex.match(/.{4}/g).join("-");
  }
  return codigoEnCache;
}

function claveValida(clave) {
  const limpia = String(clave || "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(limpia)) return false;
  try {
    return crypto.verify(null, Buffer.from(PREFIJO_FIRMA + codigoDeEquipo()), clavePublica, Buffer.from(limpia, "base64url"));
  } catch {
    return false;
  }
}

function estaActivado(archivoLicencia) {
  try {
    return claveValida(fs.readFileSync(archivoLicencia, "utf8"));
  } catch {
    return false;
  }
}

/** Guarda la clave si es válida para este equipo. Devuelve true si quedó activado. */
function activar(archivoLicencia, clave) {
  if (!claveValida(clave)) return false;
  fs.writeFileSync(archivoLicencia, String(clave).replace(/\s+/g, ""), "utf8");
  return true;
}

module.exports = { codigoDeEquipo, estaActivado, activar };
