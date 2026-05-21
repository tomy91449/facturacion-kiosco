"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const router_1 = require("./api/router");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || "4000";
app.use(express_1.default.json());
// Servir el frontend estático desde la carpeta /public
app.use(express_1.default.static(path_1.default.join(process.cwd(), "public")));
// Rutas de la API
app.use("/", router_1.apiRouter);
app.listen(Number(PORT), "127.0.0.1", () => {
    console.log(`🚀 Backend corriendo en http://localhost:${PORT}`);
});
