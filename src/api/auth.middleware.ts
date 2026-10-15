import { Request, Response, NextFunction } from "express";
import { AuthService, AuthUser, Role } from "../modules/auth/auth.service";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Exige un header "Authorization: Bearer <token>" válido. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ success: false, error: "No autenticado" });
  }

  AuthService.verifyToken(token)
    .then((user) => {
      if (!user) return res.status(401).json({ success: false, error: "Sesión inválida o vencida" });
      req.user = user;
      next();
    })
    .catch(next);
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "No tenés permisos para esta acción" });
    }
    next();
  };
}
