import express from "express";
import dotenv from "dotenv";
import { apiRouter } from "./api/router";

dotenv.config();

const app  = express();
const PORT = process.env.PORT ?? 4000;

app.use(express.json());
app.use("/", apiRouter);

app.listen(PORT, () => {
  console.log(`[POS System] Servidor corriendo en http://localhost:${PORT}`);
});
