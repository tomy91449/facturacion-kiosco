import jwt from "jsonwebtoken";
import { prisma } from "../../db";
import { hashPassword, verifyPassword } from "./password";

export type Role = "ADMIN" | "CASHIER";

export interface AuthUser {
  id:        number;
  username:  string;
  role:      Role;
  storeId:   number | null;
  storeName: string | null;
}

interface TokenPayload {
  sub: string;
}

/** Lee y valida JWT_SECRET. Se llama al arrancar para fallar rápido si falta. */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET no está definido o tiene menos de 32 caracteres");
  }
  return secret;
}

// Hash descartable para que un usuario inexistente tarde lo mismo que uno real
let dummyHash: Promise<string> | null = null;

export const AuthService = {

  async login(username: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    const user = await prisma.user.findUnique({ where: { username }, include: { store: true } });

    if (!user) {
      dummyHash ??= hashPassword("contraseña-inexistente");
      await verifyPassword(password, await dummyHash);
      return null;
    }
    if (!(await verifyPassword(password, user.passwordHash))) return null;

    const authUser = await this.loadActiveUser(user.id);
    if (!authUser) return null;

    const token = jwt.sign({} as object, getJwtSecret(), {
      algorithm: "HS256",
      subject:   String(user.id),
      expiresIn: (process.env.JWT_EXPIRES_IN ?? "12h") as jwt.SignOptions["expiresIn"],
    });
    return { token, user: authUser };
  },

  /** Verifica el token y devuelve el usuario vigente, o null si no es válido. */
  async verifyToken(token: string): Promise<AuthUser | null> {
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as TokenPayload;
    } catch {
      return null;
    }
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) return null;
    return this.loadActiveUser(userId);
  },

  /**
   * Se consulta la base en cada request para que desactivar un usuario
   * o un local corte el acceso al instante, sin esperar a que venza el token.
   */
  async loadActiveUser(userId: number): Promise<AuthUser | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { store: true } });
    if (!user || !user.active) return null;

    if (user.role === "CASHIER" && (!user.store || !user.store.active)) return null;
    if (user.role !== "ADMIN" && user.role !== "CASHIER") return null;

    return {
      id:        user.id,
      username:  user.username,
      role:      user.role as Role,
      storeId:   user.storeId,
      storeName: user.store?.name ?? null,
    };
  },
};
