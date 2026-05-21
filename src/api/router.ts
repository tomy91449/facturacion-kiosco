import { Router, Request, Response, NextFunction } from "express";
import { ProductService, SaleService } from "../modules/sale/sale.service";

// Forzamos a Node a requerir el archivo de manera exacta
const { PrismaClient } = require("../generated/client");

export const apiRouter = Router();
const prisma = new PrismaClient();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

// ── PRODUCTOS ──────────────────────────────────────────────

apiRouter.get(
  "/products",
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({ orderBy: { description: "asc" } });
    return res.json({ success: true, data: products, count: products.length });
  })
);

apiRouter.post(
  "/products",
  asyncHandler(async (req, res) => {
    const { barcode, description, price, cost, stock, minStock, categoryId } = req.body;
    if (!barcode || !description || price == null || cost == null) {
      return res.status(400).json({ success: false, error: "Faltan campos obligatorios: barcode, description, price, cost" });
    }
    const product = await prisma.product.create({
      data: { barcode, description, price, cost, stock: stock ?? 0, minStock: minStock ?? 0, categoryId: categoryId ?? null },
    });
    return res.status(201).json({ success: true, data: product });
  })
);

apiRouter.get(
  "/products/barcode/:code",
  asyncHandler(async (req, res) => {
    const product = await ProductService.findByBarcode(req.params.code);
    if (!product) return res.status(404).json({ success: false, error: `Producto no encontrado: ${req.params.code}` });
    return res.json({ success: true, data: product });
  })
);

apiRouter.get(
  "/products/low-stock",
  asyncHandler(async (_req, res) => {
    const products = await ProductService.getLowStockProducts();
    return res.json({ success: true, data: products, count: products.length });
  })
);

apiRouter.patch(
  "/products/:id/price",
  asyncHandler(async (req, res) => {
    const { price, cost } = req.body as { price: number; cost?: number };
    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({ success: false, error: "Precio invalido" });
    }
    const updated = await ProductService.updatePrice(Number(req.params.id), price, cost);
    return res.json({ success: true, data: updated });
  })
);

// ── VENTAS ─────────────────────────────────────────────────

apiRouter.post(
  "/sales",
  asyncHandler(async (req, res) => {
    const body = req.body;
    if (!body.items?.length) {
      return res.status(400).json({ success: false, error: "Se requiere al menos un item" });
    }
    const validMethods = ["CASH", "CARD", "TRANSFER", "QR", "MIXED"];
    if (!validMethods.includes(body.paymentMethod)) {
      return res.status(400).json({ success: false, error: "Metodo de pago invalido. Usar: CASH, CARD, TRANSFER, QR, MIXED" });
    }
    const result = await SaleService.registerSale(body);
    if (!result.success) return res.status(422).json(result);
    return res.status(201).json(result);
  })
);

apiRouter.post(
  "/sales/:id/cancel",
  asyncHandler(async (req, res) => {
    const sale = await SaleService.cancelSale(Number(req.params.id));
    return res.json({ success: true, data: sale });
  })
);

apiRouter.get(
  "/sales/daily-summary",
  asyncHandler(async (req, res) => {
    const date = req.query.date ? new Date(req.query.date as string) : new Date();
    const summary = await SaleService.getDailySummary(date);
    return res.json({ success: true, data: summary });
  })
);

apiRouter.get(
  "/sales",
  asyncHandler(async (_req, res) => {
    const sales = await prisma.sale.findMany({
      include: { items: { include: { product: true } }, customer: true },
      orderBy: { date: "desc" },
      take: 50,
    });
    return res.json({ success: true, data: sales, count: sales.length });
  })
);

// ── ERROR HANDLER ──────────────────────────────────────────

apiRouter.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[API Error]", err.message);
  res.status(500).json({ success: false, error: err.message });
});