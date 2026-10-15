import { PrismaClient } from "./generated/client";

// Única instancia de Prisma compartida por toda la app
export const prisma = new PrismaClient({ log: ["warn", "error"] });
