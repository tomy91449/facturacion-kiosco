import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthService } from "../modules/auth/auth.service";
import { requireAuth } from "./auth.middleware";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

// ── Límite de intentos fallidos (en memoria, por IP + usuario) ──
const MAX_FAILED   = 5;
const WINDOW_MS    = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; firstAt: number }>();

// Limpieza periódica para que el mapa no crezca indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failedLogins) {
    if (now - entry.firstAt > WINDOW_MS) failedLogins.delete(key);
  }
}, WINDOW_MS).unref();

function isBlocked(key: string): boolean {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED;
}

function registerFailure(key: string) {
  const entry = failedLogins.get(key);
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    failedLogins.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count++;
  }
}

authRouter.post("/login", (req: Request, res: Response, next: NextFunction) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Usuario y contraseña son obligatorios" });
  }
  const { username, password } = parsed.data;
  const key = `${req.ip}|${username.toLowerCase()}`;

  if (isBlocked(key)) {
    return res.status(429).json({ success: false, error: "Demasiados intentos fallidos. Probá de nuevo en 15 minutos." });
  }

  AuthService.login(username, password)
    .then((result) => {
      if (!result) {
        registerFailure(key);
        return res.status(401).json({ success: false, error: "Usuario o contraseña incorrectos" });
      }
      failedLogins.delete(key);
      return res.json({ success: true, token: result.token, user: result.user });
    })
    .catch(next);
});

authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json({ success: true, user: req.user });
});
