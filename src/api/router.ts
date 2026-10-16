import { Router, Request, Response, NextFunction } from "express";
import { ProductService, SaleService, normalizeBarcode } from "../modules/sale/sale.service";
import { prisma } from "../db";
import { authRouter } from "./auth.routes";
import { adminRouter } from "./admin.routes";
import { paymentRouter } from "./payment.routes";
import { setupRouter } from "./setup.routes";
import { requireAuth } from "./auth.middleware";
import { asyncHandler, readStoreScope, requireStoreScope } from "./store-scope";

export const apiRouter = Router();

// ── AUTENTICACIÓN ──────────────────────────────────────────
// /auth/login y /setup (primer uso) son las únicas rutas públicas; todo lo que sigue exige token.

apiRouter.use("/auth", authRouter);
apiRouter.use("/setup", setupRouter);
apiRouter.use(requireAuth);

// ── ADMINISTRACIÓN (locales y usuarios, solo ADMIN) ────────

apiRouter.use(adminRouter);

// ── PRODUCTOS ──────────────────────────────────────────────

apiRouter.get(
  "/products",
  asyncHandler(async (req, res) => {
    const storeId  = readStoreScope(req);
    const products = await prisma.product.findMany({
      where:   storeId !== null ? { storeId } : {},
      orderBy: { description: "asc" },
    });
    return res.json({ success: true, data: products, count: products.length });
  })
);

apiRouter.post(
  "/products",
  asyncHandler(async (req, res) => {
    const storeId = await requireStoreScope(req, res);
    if (storeId === null) return;

    const { barcode, description, price, cost, stock, minStock, categoryId } = req.body;
    if (!barcode || !description || price == null || cost == null) {
      return res.status(400).json({ success: false, error: "Faltan campos obligatorios: barcode, description, price, cost" });
    }
    const product = await prisma.product.create({
      data: {
        storeId,
        barcode: normalizeBarcode(String(barcode)),
        description, price, cost,
        stock: stock ?? 0, minStock: minStock ?? 0, categoryId: categoryId ?? null,
      },
    });
    return res.status(201).json({ success: true, data: product });
  })
);

apiRouter.get(
  "/products/barcode/:code",
  asyncHandler(async (req, res) => {
    const storeId = await requireStoreScope(req, res);
    if (storeId === null) return;

    const product = await ProductService.findByBarcode(storeId, req.params.code);
    if (!product) return res.status(404).json({ success: false, error: `Producto no encontrado: ${req.params.code}` });
    return res.json({ success: true, data: product });
  })
);

apiRouter.get(
  "/products/low-stock",
  asyncHandler(async (req, res) => {
    const products = await ProductService.getLowStockProducts(readStoreScope(req));
    return res.json({ success: true, data: products, count: products.length });
  })
);

apiRouter.patch(
  "/products/:id/price",
  asyncHandler(async (req, res) => {
    const storeId = await requireStoreScope(req, res);
    if (storeId === null) return;

    const { price, cost } = req.body as { price: number; cost?: number };
    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({ success: false, error: "Precio invalido" });
    }
    const updated = await ProductService.updatePrice(storeId, Number(req.params.id), price, cost);
    if (!updated) return res.status(404).json({ success: false, error: "Producto no encontrado" });
    return res.json({ success: true, data: updated });
  })
);

// ── VENTAS ─────────────────────────────────────────────────

// Cobrar (POST /sales) y seguimiento de pagos: QR, alias, efectivo, posnet
apiRouter.use(paymentRouter);

apiRouter.post(
  "/sales/:id/cancel",
  asyncHandler(async (req, res) => {
    const storeId = await requireStoreScope(req, res);
    if (storeId === null) return;

    const sale = await SaleService.cancelSale(storeId, Number(req.params.id));
    return res.json({ success: true, data: sale });
  })
);

apiRouter.get(
  "/sales/daily-summary",
  asyncHandler(async (req, res) => {
    const date    = req.query.date ? new Date(req.query.date as string) : new Date();
    const summary = await SaleService.getDailySummary(readStoreScope(req), date);
    return res.json({ success: true, data: summary });
  })
);

apiRouter.get(
  "/sales",
  asyncHandler(async (req, res) => {
    const storeId = readStoreScope(req);
    const sales   = await prisma.sale.findMany({
      where:   storeId !== null ? { storeId } : {},
      include: { items: { include: { product: true } }, customer: true, store: { select: { id: true, name: true } } },
      orderBy: { date: "desc" },
      take: 50,
    });
    return res.json({ success: true, data: sales, count: sales.length });
  })
);

// ── ERROR HANDLER ──────────────────────────────────────────

apiRouter.use((err: Error & { code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  // Violación de restricción única de Prisma (código de barras, usuario o local repetido)
  if (err.code === "P2002") {
    return res.status(409).json({ success: false, error: "Ya existe un registro con ese valor" });
  }
  console.error("[API Error]", err.message);
  res.status(500).json({ success: false, error: err.message });
});
