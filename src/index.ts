import express from "express";
import dotenv from "dotenv";
import path from "path";
import { apiRouter } from "./api/router";
import { ensureAdminUser } from "./modules/auth/bootstrap";
import { getJwtSecret } from "./modules/auth/auth.service";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || "4000";
// 127.0.0.1 = solo esta PC (Electron). En Docker se usa HOST=0.0.0.0 para aceptar conexiones de la red.
const HOST = process.env.HOST || "127.0.0.1";

app.use(express.json());

// Servir el frontend estático desde la carpeta /public
app.use(express.static(path.join(process.cwd(), "public")));

// Rutas de la API
app.use("/", apiRouter);

Promise.resolve()
  .then(() => getJwtSecret()) // Falla al arrancar si falta JWT_SECRET
  .then(() => ensureAdminUser())
  .then(() => {
    app.listen(Number(PORT), HOST, () => {
      console.log(`🚀 Backend corriendo en http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ No se pudo iniciar el servidor:", err.message);
    process.exit(1);
  });