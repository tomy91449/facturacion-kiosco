import express from "express";
import dotenv from "dotenv";
import path from "path";
import { apiRouter } from "./api/router";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || "4000";

app.use(express.json());

// Servir el frontend estático desde la carpeta /public
app.use(express.static(path.join(process.cwd(), "public")));

// Rutas de la API
app.use("/", apiRouter);

app.listen(Number(PORT), "127.0.0.1", () => {
  console.log(`🚀 Backend corriendo en http://localhost:${PORT}`);
});