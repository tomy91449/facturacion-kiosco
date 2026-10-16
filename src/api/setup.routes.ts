import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { hashPassword } from "../modules/auth/password";
import { asyncHandler } from "./store-scope";

/**
 * Primer uso: mientras la base no tenga usuarios, permite crear el administrador
 * desde la pantalla (lo usa el programa de escritorio, que no tiene .env).
 */
export const setupRouter = Router();

const setupSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "Usuario: solo letras, números, punto, guion y guion bajo"),
  password: z.string().min(10, "La contraseña debe tener al menos 10 caracteres").max(256),
});

// Solo desde la misma PC: nadie en la red puede apropiarse del sistema recién instalado
function isLocalRequest(ip: string | undefined): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

setupRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, needsSetup: (await prisma.user.count()) === 0 });
  })
);

setupRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!isLocalRequest(req.socket.remoteAddress)) {
      return res.status(403).json({ success: false, error: "La configuración inicial solo se puede hacer desde la PC del sistema" });
    }
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0].message });
    }
    const { username, password } = parsed.data;
    const passwordHash = await hashPassword(password);

    // Dentro de la transacción: dos pedidos simultáneos no pueden crear dos administradores
    const created = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) return false;
      await tx.user.create({ data: { username, passwordHash, role: "ADMIN" } });
      return true;
    });
    if (!created) {
      return res.status(409).json({ success: false, error: "El sistema ya tiene un administrador" });
    }
    return res.status(201).json({ success: true });
  })
);
