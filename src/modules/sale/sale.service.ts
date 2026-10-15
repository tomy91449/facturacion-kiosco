import { prisma } from "../../db";

// ── Tipos ────────────────────────────────────
export interface SaleItemInput {
  productId: number;
  quantity:  number;
}

export interface CreateSaleInput {
  items:         SaleItemInput[];
  customerId?:   number;
  paymentMethod: string;
  discount?:     number;
  taxRate?:      number;
  notes?:        string;
  printTicket?:  boolean;
}

export interface SaleResult {
  success:     boolean;
  saleId?:     number;
  grandTotal?: number;
  printed?:    boolean;
  error?:      string;
}

/** Los códigos se guardan y buscan normalizados para que coincidan siempre */
export function normalizeBarcode(barcode: string): string {
  return barcode.trim().toUpperCase();
}

// ── ProductService ───────────────────────────
// Todas las operaciones reciben el storeId: un local nunca ve datos de otro.
export const ProductService = {

  async findByBarcode(storeId: number, barcode: string) {
    if (!barcode || barcode.trim().length === 0) {
      throw new Error("El código de barras no puede estar vacío");
    }
    const product = await prisma.product.findUnique({
      where:   { storeId_barcode: { storeId, barcode: normalizeBarcode(barcode) } },
      include: { category: true },
    });
    if (!product) return null;
    if (!product.active) throw new Error(`El producto "${product.description}" está inactivo`);
    return product;
  },

  /** storeId null = todos los locales (solo para ADMIN) */
  async getLowStockProducts(storeId: number | null) {
    return prisma.product.findMany({
      where:   { active: true, stock: { lte: 5 }, ...(storeId !== null && { storeId }) },
      orderBy: { stock: "asc" },
    });
  },

  async updatePrice(storeId: number, productId: number, price: number, cost?: number) {
    const { count } = await prisma.product.updateMany({
      where: { id: productId, storeId },
      data:  { price, ...(cost !== undefined && { cost }) },
    });
    if (count === 0) return null;
    return prisma.product.findUnique({ where: { id: productId } });
  },
};

// ── SaleService ──────────────────────────────
export const SaleService = {

  async registerSale(storeId: number, input: CreateSaleInput): Promise<SaleResult> {
    const { items, customerId, paymentMethod, discount = 0, taxRate = 0, notes, printTicket = false } = input;

    if (!items || items.length === 0) {
      return { success: false, error: "La venta debe tener al menos un ítem" };
    }

    try {
      const productIds = items.map((i) => i.productId);
      const products   = await prisma.product.findMany({
        where: { id: { in: productIds }, active: true, storeId },
      });

      if (products.length !== productIds.length) {
        return { success: false, error: "Algunos productos no fueron encontrados o están inactivos" };
      }

      if (customerId != null) {
        const customer = await prisma.customer.findFirst({ where: { id: customerId, storeId } });
        if (!customer) return { success: false, error: "Cliente no encontrado" };
      }

      const productMap = new Map(products.map((p) => [p.id, p]));

      for (const item of items) {
        const product = productMap.get(item.productId)!;
        if (product.stock < item.quantity) {
          return { success: false, error: `Stock insuficiente para "${product.description}". Disponible: ${product.stock}` };
        }
      }

      let saleTotal = 0;
      const lineItems: any[] = [];

      for (const item of items) {
        const product  = productMap.get(item.productId)!;
        const subtotal = product.price * item.quantity;
        saleTotal     += subtotal;
        lineItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: product.price, subtotal });
      }

      const taxAmount  = saleTotal * taxRate;
      const grandTotal = saleTotal - discount + taxAmount;

      const sale = await prisma.$transaction(async (tx) => {
        const newSale = await tx.sale.create({
          data: {
            storeId,
            customerId,
            paymentMethod,
            total:      saleTotal,
            discount,
            tax:        taxAmount,
            grandTotal,
            notes,
            items: { create: lineItems },
          },
          include: { items: { include: { product: true } }, customer: true },
        });

        await Promise.all(
          items.map((item) =>
            tx.product.update({
              where: { id: item.productId },
              data:  { stock: { decrement: item.quantity } },
            })
          )
        );

        return newSale;
      });

      return { success: true, saleId: sale.id, grandTotal: sale.grandTotal, printed: false };

    } catch (err) {
      const message = err instanceof Error ? err.message : "Error interno";
      return { success: false, error: message };
    }
  },

  async cancelSale(storeId: number, saleId: number) {
    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } });
      // Una venta de otro local se trata igual que una inexistente
      if (!sale || sale.storeId !== storeId) throw new Error(`Venta ${saleId} no encontrada`);
      if (sale.status !== "COMPLETED") throw new Error(`La venta ya está en estado ${sale.status}`);

      await Promise.all(
        sale.items.map((item) =>
          tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } })
        )
      );

      return tx.sale.update({ where: { id: saleId }, data: { status: "CANCELLED" } });
    });
  },

  /** storeId null = todos los locales (solo para ADMIN) */
  async getDailySummary(storeId: number | null, date: Date = new Date()) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);

    const sales = await prisma.sale.findMany({
      where: { date: { gte: start, lte: end }, status: "COMPLETED", ...(storeId !== null && { storeId }) },
    });

    const grandTotal = sales.reduce((acc, s) => acc + s.grandTotal, 0);

    return {
      date:               date.toISOString().split("T")[0],
      totalTransactions:  sales.length,
      grandTotal,
      byPaymentMethod: {
        cash:     sales.filter((s) => s.paymentMethod === "CASH").reduce((a, s) => a + s.grandTotal, 0),
        card:     sales.filter((s) => s.paymentMethod === "CARD").reduce((a, s) => a + s.grandTotal, 0),
        transfer: sales.filter((s) => s.paymentMethod === "TRANSFER").reduce((a, s) => a + s.grandTotal, 0),
        qr:       sales.filter((s) => s.paymentMethod === "QR").reduce((a, s) => a + s.grandTotal, 0),
      },
    };
  },
};
