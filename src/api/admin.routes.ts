import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { hashPassword } from "../modules/auth/password";
import { requireRole } from "./auth.middleware";
import { asyncHandler } from "./store-scope";

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

const createUserSchema = z
  .object({
    username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "Usuario: solo letras, números, punto, guion y guion bajo"),
    password: passwordSchema,
    role:     z.enum(["ADMIN", "CASHIER"]).default("CASHIER"),
    storeId:  z.number().int().positive().nullable().optional(),
  })
  .refine((u) => (u.role === "CASHIER" ? u.storeId != null : u.storeId == null), {
    message: "Un CASHIER debe tener local; un ADMIN no debe tenerlo",
  });

const updateUserSchema = z.object({
  password: passwordSchema.optional(),
  active:   z.boolean().optional(),
  storeId:  z.number().int().positive().optional(),
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
    const { password, active, storeId } = parsed.data;

    const target = await prisma.user.findUnique({ where: { id: id.data } });
    if (!target) return res.status(404).json({ success: false, error: "Usuario no encontrado" });

    if (target.id === req.user!.id && active === false) {
      return res.status(400).json({ success: false, error: "No podés desactivar tu propio usuario" });
    }
    if (storeId !== undefined) {
      if (target.role !== "CASHIER") return res.status(400).json({ success: false, error: "Solo un CASHIER tiene local" });
      if (!(await prisma.store.findUnique({ where: { id: storeId } }))) {
        return res.status(404).json({ success: false, error: "Local no encontrado" });
      }
    }

    const user = await prisma.user.update({
      where:  { id: target.id },
      data:   {
        ...(active   !== undefined && { active }),
        ...(storeId  !== undefined && { storeId }),
        ...(password !== undefined && { passwordHash: await hashPassword(password) }),
      },
      select: publicUserFields,
    });
    return res.json({ success: true, data: user });
  })
);
