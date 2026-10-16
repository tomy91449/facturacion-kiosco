import express from "express";
import dotenv from "dotenv";
import path from "path";
import { AddressInfo } from "net";
import { apiRouter } from "./api/router";
import { ensureAdminUser } from "./modules/auth/bootstrap";
import { getJwtSecret } from "./modules/auth/auth.service";
import { PaymentService } from "./modules/payment/payment.service";
import { isQrSimulatorActive } from "./modules/payment/provider-registry";

dotenv.config();

const app = express();

app.use(express.json());

// Servir el frontend estático desde la carpeta /public (relativa al código, no a la carpeta de trabajo,
// para que funcione también dentro del programa instalado)
app.use(express.static(path.join(__dirname, "..", "public")));

// Rutas de la API
app.use("/", apiRouter);

/**
 * Valida la configuración y arranca el servidor. Devuelve el puerto en el que quedó escuchando
 * (con port 0 el sistema elige uno libre: lo usa el programa de escritorio).
 */
export async function startServer(port: number, host: string): Promise<number> {
  getJwtSecret(); // Falla al arrancar si falta JWT_SECRET
  await ensureAdminUser();
  if (isQrSimulatorActive()) {
    console.warn("⚠️  QR_PROVIDER=simulator: los cobros con QR son de PRUEBA, no entra dinero real.");
  }
  PaymentService.startSweeper();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const { port: actual } = server.address() as AddressInfo;
      console.log(`🚀 Backend corriendo en http://${host}:${actual}`);
      resolve(actual);
    });
    server.on("error", reject);
  });
}

// Ejecutado directamente (node dist/index.js, Docker, npm run dev)
if (require.main === module) {
  // 127.0.0.1 = solo esta PC. En Docker se usa HOST=0.0.0.0 para aceptar conexiones de la red.
  startServer(Number(process.env.PORT || "4000"), process.env.HOST || "127.0.0.1").catch((err) => {
    console.error("❌ No se pudo iniciar el servidor:", err.message);
    process.exit(1);
  });
}
