import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { hashPassword } from "../modules/auth/password";
import { requireRole } from "./auth.middleware";
import { asyncHandler, readStoreScope } from "./store-scope";
import { StatsService, localDay, parseLocalDay } from "../modules/stats/stats.service";

export const adminRouter = Router();

const onlyAdmin = requireRole("ADMIN");

// Nunca se devuelve el hash de la contraseña
const publicUserFields = {
  id: true, username: true, role: true, storeId: true, active: true, createdAt: true,
  store: { select: { id: true, name: true } },
} as const;

const idParam = z.coerce.number().int().positive();

// ── LOCALES ────────────────────────────────────────────────

const storeSchema = z.object({
  name:    z.string().trim().min(1).max(100),
  address: z.string().trim().max(200).optional(),
  phone:   z.string().trim().max(50).optional(),
  taxId:   z.string().trim().max(20).optional(),
  // Alias bancario/billetera: 6 a 20 caracteres, letras, números, punto y guion
  transferAlias:  z.string().trim().regex(/^[a-zA-Z0-9.-]{6,20}$/, "Alias inválido").nullable().optional(),
  transferHolder: z.string().trim().max(100).nullable().optional(),
});

adminRouter.get(
  "/stores",
  onlyAdmin,
  asyncHandler(async (_req, res) => {
    const stores = await prisma.store.findMany({ orderBy: { name: "asc" } });
    return res.json({ success: true, data: stores });
  })
);

adminRouter.post(
  "/stores",
  onlyAdmin,
  asyncHandler(async (req, res) => {
    const parsed = storeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: "Datos del local inválidos" });
    const store = await prisma.store.create({ data: { ...parsed.data, name: parsed.data.name! } });
    return res.status(201).json({ success: true, data: store });
  })
);

adminRouter.patch(
  "/stores/:id",
  onlyAdmin,
  asyncHandler(async (req, res) => {
    const id     = idParam.safeParse(req.params.id);
    const parsed = storeSchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ success: false, error: "Datos del local inválidos" });

    const exists = await prisma.store.findUnique({ where: { id: id.data } });
    if (!exists) return res.status(404).json({ success: false, error: "Local no encontrado" });

    const store = await prisma.store.update({ where: { id: id.data }, data: parsed.data });
    return res.json({ success: true, data: store });
  })
);

// ── USUARIOS ───────────────────────────────────────────────

const passwordSchema = z.string().min(10, "La contraseña debe tener al menos 10 caracteres").max(256);
const usernameSchema = z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "Usuario: solo letras, números, punto, guion y guion bajo");

const createUserSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    role:     z.enum(["ADMIN", "CASHIER"]).default("CASHIER"),
    storeId:  z.number().int().positive().nullable().optional(),
  })
  .refine((u) => (u.role === "CASHIER" ? u.storeId != null : u.storeId == null), {
    message: "Un CASHIER debe tener local; un ADMIN no debe tenerlo",
  });

const updateUserSchema = z.object({
  username: usernameSchema.optional(),
  password: passwordSchema.optional(),
  role:     z.enum(["ADMIN", "CASHIER"]).optional(),
  active:   z.boolean().optional(),
  storeId:  z.number().int().positive().nullable().optional(),
});

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Datos inválidos";
}

adminRouter.get(
  "/users",
  onlyAdmin,
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ select: publicUserFields, orderBy: { username: "asc" } });
    return res.json({ success: true, data: users });
  })
);

adminRouter.post(
  "/users",
  onlyAdmin,
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: firstIssue(parsed.error) });
    const { username, password, role, storeId } = parsed.data;

    if (storeId != null && !(await prisma.store.findUnique({ where: { id: storeId } }))) {
      return res.status(404).json({ success: false, error: "Local no encontrado" });
    }

    const user = await prisma.user.create({
      data:   { username, role, storeId: storeId ?? null, passwordHash: await hashPassword(password) },
      select: publicUserFields,
    });
    return res.status(201).json({ success: true, data: user });
  })
);

adminRouter.patch(
  "/users/:id",
  onlyAdmin,
  asyncHandler(async (req, res) => {
    const id     = idParam.safeParse(req.params.id);
    const parsed = updateUserSchema.safeParse(req.body);
    if (!id.success) return res.status(400).json({ success: false, error: "Id inválido" });
    if (!parsed.success) return res.status(400).json({ success: false, error: firstIssue(parsed.error) });
    const { username, password, role, active } = parsed.data;

    const target = await prisma.user.findUnique({ where: { id: id.data } });
    if (!target) return res.status(404).json({ success: false, error: "Usuario no encontrado" });

    const isSelf = target.id === req.user!.id;
    if (isSelf && active === false) {
      return res.status(400).json({ success: false, error: "No podés desactivar tu propio usuario" });
    }
    if (isSelf && role === "CASHIER") {
      return res.status(400).json({ success: false, error: "No podés quitarte el perfil de administrador" });
    }

    // Un administrador no tiene local; un cajero siempre tiene uno
    const finalRole = role ?? target.role;
    const storeId   = finalRole === "ADMIN" ? null : (parsed.data.storeId !== undefined ? parsed.data.storeId : target.storeId);
    if (finalRole === "CASHIER") {
      if (storeId == null) return res.status(400).json({ success: false, error: "Elegí el local del cajero" });
      if (!(await prisma.store.findUnique({ where: { id: storeId } }))) {
        return res.status(404).json({ success: false, error: "Local no encontrado" });
      }
    }

    // Siempre tiene que quedar al menos un administrador activo
    const losesAdmin = target.role === "ADMIN" && target.active && (finalRole !== "ADMIN" || active === false);
    if (losesAdmin && (await prisma.user.count({ where: { role: "ADMIN", active: true } })) <= 1) {
      return res.status(400).json({ success: false, error: "Tiene que quedar al menos un administrador activo" });
    }

    const user = await prisma.user.update({
      where:  { id: target.id },
      data:   {
        role: finalRole,
        storeId,
        ...(username !== undefined && { username }),
        ...(active   !== undefined && { active }),
        ...(password !== undefined && { passwordHash: await hashPassword(password) }),
      },
      select: publicUserFields,
    });
    return res.json({ success: true, data: user });
  })
);

// ── ESTADÍSTICAS ───────────────────────────────────────────

const MAX_STATS_DAYS = 366;

adminRouter.get(
  "/stats",
  onlyAdmin,
  asyncHandler(async (req, res) => {
    const hoy  = parseLocalDay(localDay(new Date()))!;
    const to   = req.query.to   ? parseLocalDay(req.query.to)   : hoy;
    const from = req.query.from ? parseLocalDay(req.query.from) : new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 29);
    if (!from || !to || from > to) {
      return res.status(400).json({ success: false, error: "Rango de fechas inválido (AAAA-MM-DD, desde ≤ hasta)" });
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 >= MAX_STATS_DAYS) {
      return res.status(400).json({ success: false, error: `El rango no puede superar ${MAX_STATS_DAYS} días` });
    }
    const stats = await StatsService.getStats(readStoreScope(req), from, to);
    return res.json({ success: true, data: stats });
  })
);
