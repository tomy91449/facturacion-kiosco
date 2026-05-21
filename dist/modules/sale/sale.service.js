"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SaleService = exports.ProductService = void 0;
const client_1 = require("../../generated/client");
const prisma = new client_1.PrismaClient({ log: ["warn", "error"] });
// ── ProductService ───────────────────────────
exports.ProductService = {
    async findByBarcode(barcode) {
        if (!barcode || barcode.trim().length === 0) {
            throw new Error("El código de barras no puede estar vacío");
        }
        const normalizedBarcode = barcode.trim().toUpperCase();
        const product = await prisma.product.findUnique({
            where: { barcode: normalizedBarcode },
            include: { category: true },
        });
        if (!product)
            return null;
        if (!product.active)
            throw new Error(`El producto "${product.description}" está inactivo`);
        return product;
    },
    async getLowStockProducts() {
        return prisma.product.findMany({
            where: { active: true, stock: { lte: 5 } },
            orderBy: { stock: "asc" },
        });
    },
    async updatePrice(productId, price, cost) {
        return prisma.product.update({
            where: { id: productId },
            data: { price, ...(cost !== undefined && { cost }) },
        });
    },
};
// ── SaleService ──────────────────────────────
exports.SaleService = {
    async registerSale(input) {
        const { items, customerId, paymentMethod, discount = 0, taxRate = 0, notes, printTicket = false } = input;
        if (!items || items.length === 0) {
            return { success: false, error: "La venta debe tener al menos un ítem" };
        }
        try {
            const productIds = items.map((i) => i.productId);
            const products = await prisma.product.findMany({
                where: { id: { in: productIds }, active: true },
            });
            if (products.length !== productIds.length) {
                return { success: false, error: "Algunos productos no fueron encontrados o están inactivos" };
            }
            const productMap = new Map(products.map((p) => [p.id, p]));
            for (const item of items) {
                const product = productMap.get(item.productId);
                if (product.stock < item.quantity) {
                    return { success: false, error: `Stock insuficiente para "${product.description}". Disponible: ${product.stock}` };
                }
            }
            let saleTotal = 0;
            const lineItems = [];
            for (const item of items) {
                const product = productMap.get(item.productId);
                const subtotal = product.price * item.quantity;
                saleTotal += subtotal;
                lineItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: product.price, subtotal });
            }
            const taxAmount = saleTotal * taxRate;
            const grandTotal = saleTotal - discount + taxAmount;
            const sale = await prisma.$transaction(async (tx) => {
                const newSale = await tx.sale.create({
                    data: {
                        customerId,
                        paymentMethod,
                        total: saleTotal,
                        discount,
                        tax: taxAmount,
                        grandTotal,
                        notes,
                        items: { create: lineItems },
                    },
                    include: { items: { include: { product: true } }, customer: true },
                });
                await Promise.all(items.map((item) => tx.product.update({
                    where: { id: item.productId },
                    data: { stock: { decrement: item.quantity } },
                })));
                return newSale;
            });
            return { success: true, saleId: sale.id, grandTotal: sale.grandTotal, printed: false };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Error interno";
            return { success: false, error: message };
        }
    },
    async cancelSale(saleId) {
        return prisma.$transaction(async (tx) => {
            const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } });
            if (!sale)
                throw new Error(`Venta ${saleId} no encontrada`);
            if (sale.status !== "COMPLETED")
                throw new Error(`La venta ya está en estado ${sale.status}`);
            await Promise.all(sale.items.map((item) => tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } })));
            return tx.sale.update({ where: { id: saleId }, data: { status: "CANCELLED" } });
        });
    },
    async getDailySummary(date = new Date()) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        const sales = await prisma.sale.findMany({
            where: { date: { gte: start, lte: end }, status: "COMPLETED" },
        });
        const grandTotal = sales.reduce((acc, s) => acc + s.grandTotal, 0);
        return {
            date: date.toISOString().split("T")[0],
            totalTransactions: sales.length,
            grandTotal,
            byPaymentMethod: {
                cash: sales.filter((s) => s.paymentMethod === "CASH").reduce((a, s) => a + s.grandTotal, 0),
                card: sales.filter((s) => s.paymentMethod === "CARD").reduce((a, s) => a + s.grandTotal, 0),
                transfer: sales.filter((s) => s.paymentMethod === "TRANSFER").reduce((a, s) => a + s.grandTotal, 0),
                qr: sales.filter((s) => s.paymentMethod === "QR").reduce((a, s) => a + s.grandTotal, 0),
            },
        };
    },
};
