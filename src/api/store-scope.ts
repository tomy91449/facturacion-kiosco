import { Request, Response, NextFunction } from "express";
import { prisma } from "../db";

export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Local sobre el que opera el request.
 * - CASHIER: siempre su propio local; cualquier storeId que mande se ignora.
 * - ADMIN: el storeId que pida (query o body), o null = todos los locales.
 */
export function readStoreScope(req: Request): number | null {
  const user = req.user!;
  if (user.role !== "ADMIN") return user.storeId;
  return parseId(req.query.storeId ?? req.body?.storeId);
}

/**
 * Igual que readStoreScope, pero para operaciones que necesitan un local concreto
 * (crear productos, registrar ventas, etc.). Si no hay local válido, responde
 * el error y devuelve null.
 */
export async function requireStoreScope(req: Request, res: Response): Promise<number | null> {
  const storeId = readStoreScope(req);
  if (storeId === null) {
    res.status(400).json({ success: false, error: "Indicá el local (storeId) para esta operación" });
    return null;
  }
  if (req.user!.role === "ADMIN") {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store || !store.active) {
      res.status(404).json({ success: false, error: "Local no encontrado o inactivo" });
      return null;
    }
  }
  return storeId;
}
