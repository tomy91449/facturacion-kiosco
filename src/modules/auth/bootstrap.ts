import { prisma } from "../../db";
import { hashPassword } from "./password";

/**
 * Si la base no tiene usuarios, crea el administrador inicial
 * con ADMIN_USERNAME / ADMIN_PASSWORD del .env.
 */
export async function ensureAdminUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;

  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn("⚠️ No hay usuarios: creá el administrador desde la pantalla de primer uso (o con ADMIN_USERNAME y ADMIN_PASSWORD en el .env).");
    return;
  }
  if (password.length < 10) {
    throw new Error("ADMIN_PASSWORD debe tener al menos 10 caracteres");
  }

  await prisma.user.create({
    data: { username, passwordHash: await hashPassword(password), role: "ADMIN" },
  });
  console.log(`👤 Administrador inicial "${username}" creado. Podés borrar ADMIN_PASSWORD del .env.`);
}
