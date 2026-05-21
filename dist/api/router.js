"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRouter = void 0;
const express_1 = require("express");
const sale_service_1 = require("../modules/sale/sale.service");
// Forzamos a Node a requerir el archivo de manera exacta
const { PrismaClient } = require("../generated/client");
exports.apiRouter = (0, express_1.Router)();
const prisma = new PrismaClient();
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);
// ── PRODUCTOS ──────────────────────────────────────────────
exports.apiRouter.get("/products", asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({ orderBy: { description: "asc" } });
    return res.json({ success: true, data: products, count: products.length });
}));
exports.apiRouter.post("/products", asyncHandler(async (req, res) => {
    const { barcode, description, price, cost, stock, minStock, categoryId } = req.body;
    if (!barcode || !description || price == null || cost == null) {
        return res.status(400).json({ success: false, error: "Faltan campos obligatorios: barcode, description, price, cost" });
    }
    const product = await prisma.product.create({
        data: { barcode, description, price, cost, stock: stock ?? 0, minStock: minStock ?? 0, categoryId: categoryId ?? null },
    });
    return res.status(201).json({ success: true, data: product });
}));
exports.apiRouter.get("/products/barcode/:code", asyncHandler(async (req, res) => {
    const product = await sale_service_1.ProductService.findByBarcode(req.params.code);
    if (!product)
        return res.status(404).json({ success: false, error: `Producto no encontrado: ${req.params.code}` });
    return res.json({ success: true, data: product });
}));
exports.apiRouter.get("/products/low-stock", asyncHandler(async (_req, res) => {
    const products = await sale_service_1.ProductService.getLowStockProducts();
    return res.json({ success: true, data: products, count: products.length });
}));
exports.apiRouter.patch("/products/:id/price", asyncHandler(async (req, res) => {
    const { price, cost } = req.body;
    if (typeof price !== "number" || price < 0) {
        return res.status(400).json({ success: false, error: "Precio invalido" });
    }
    const updated = await sale_service_1.ProductService.updatePrice(Number(req.params.id), price, cost);
    return res.json({ success: true, data: updated });
}));
// ── VENTAS ─────────────────────────────────────────────────
exports.apiRouter.post("/sales", asyncHandler(async (req, res) => {
    const body = req.body;
    if (!body.items?.length) {
        return res.status(400).json({ success: false, error: "Se requiere al menos un item" });
    }
    const validMethods = ["CASH", "CARD", "TRANSFER", "QR", "MIXED"];
    if (!validMethods.includes(body.paymentMethod)) {
        return res.status(400).json({ success: false, error: "Metodo de pago invalido. Usar: CASH, CARD, TRANSFER, QR, MIXED" });
    }
    const result = await sale_service_1.SaleService.registerSale(body);
    if (!result.success)
        return res.status(422).json(result);
    return res.status(201).json(result);
}));
exports.apiRouter.post("/sales/:id/cancel", asyncHandler(async (req, res) => {
    const sale = await sale_service_1.SaleService.cancelSale(Number(req.params.id));
    return res.json({ success: true, data: sale });
}));
exports.apiRouter.get("/sales/daily-summary", asyncHandler(async (req, res) => {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const summary = await sale_service_1.SaleService.getDailySummary(date);
    return res.json({ success: true, data: summary });
}));
exports.apiRouter.get("/sales", asyncHandler(async (_req, res) => {
    const sales = await prisma.sale.findMany({
        include: { items: { include: { product: true } }, customer: true },
        orderBy: { date: "desc" },
        take: 50,
    });
    return res.json({ success: true, data: sales, count: sales.length });
}));
// ── ERROR HANDLER ──────────────────────────────────────────
exports.apiRouter.use((err, _req, res, _next) => {
    console.error("[API Error]", err.message);
    res.status(500).json({ success: false, error: err.message });
});
