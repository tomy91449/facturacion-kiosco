import { prisma } from "../../db";
import { Prisma } from "../../generated/client";

type Tx = Prisma.TransactionClient;

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
  notes?:        string;
}

/** Venta ya validada y con precios calculados en el servidor, lista para guardarse */
export interface SaleDraft {
  storeId:       number;
  customerId?:   number;
  paymentMethod: string;
  total:         number;
  discount:      number;
  tax:           number;
  grandTotal:    number;
  notes?:        string;
  lineItems:     { productId: number; quantity: number; unitPrice: number; subtotal: number }[];
}

export type SaleStatus = "PENDING_PAYMENT" | "COMPLETED" | "CANCELLED";

/** Redondea a centavos para que los montos coincidan exactamente con el proveedor de pago */
export const toCents = (n: number) => Math.round(n * 100) / 100;

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

  /**
   * Valida la venta y calcula los montos con los precios de la base.
   * Nunca se confía en precios ni totales que mande el navegador.
   */
  async prepareSale(storeId: number, input: CreateSaleInput): Promise<{ draft: SaleDraft } | { error: string }> {
    const { items, customerId, paymentMethod, discount = 0, notes } = input;

    if (!items || items.length === 0) return { error: "La venta debe tener al menos un ítem" };

    // El mismo producto en dos líneas se suma en una sola
    const quantities = new Map<number, number>();
    for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);

    const products = await prisma.product.findMany({
      where: { id: { in: [...quantities.keys()] }, active: true, storeId },
    });
    if (products.length !== quantities.size) {
      return { error: "Algunos productos no fueron encontrados o están inactivos" };
    }

    if (customerId != null) {
      const customer = await prisma.customer.findFirst({ where: { id: customerId, storeId } });
      if (!customer) return { error: "Cliente no encontrado" };
    }

    const lineItems: SaleDraft["lineItems"] = [];
    let total = 0;
    for (const product of products) {
      const quantity = quantities.get(product.id)!;
      if (product.stock < quantity) {
        return { error: `Stock insuficiente para "${product.description}". Disponible: ${product.stock}` };
      }
      const subtotal = toCents(product.price * quantity);
      total += subtotal;
      lineItems.push({ productId: product.id, quantity, unitPrice: product.price, subtotal });
    }

    total = toCents(total);
    if (discount > total) return { error: "El descuento no puede superar el total" };
    const grandTotal = toCents(total - discount);
    if (grandTotal <= 0) return { error: "El total de la venta debe ser mayor a cero" };

    return { draft: { storeId, customerId, paymentMethod, total, discount, tax: 0, grandTotal, notes, lineItems } };
  },

  /**
   * Guarda la venta y descuenta (o reserva, si queda pendiente de pago) el stock.
   * El descuento es condicional: si otra caja vendió la última unidad, falla en vez de dejar stock negativo.
   */
  async createSale(tx: Tx, draft: SaleDraft, status: SaleStatus) {
    const { lineItems, ...data } = draft;
    const sale = await tx.sale.create({ data: { ...data, status, items: { create: lineItems } } });

    for (const item of lineItems) {
      const { count } = await tx.product.updateMany({
        where: { id: item.productId, storeId: draft.storeId, stock: { gte: item.quantity } },
        data:  { stock: { decrement: item.quantity } },
      });
      if (count === 0) throw new Error("Stock insuficiente: otra caja vendió el producto recién. Revisá el ticket.");
    }
    return sale;
  },

  /** Pendiente → completada. Devuelve false si la venta ya no estaba pendiente. */
  async completePendingSale(tx: Tx, saleId: number): Promise<boolean> {
    const { count } = await tx.sale.updateMany({
      where: { id: saleId, status: "PENDING_PAYMENT" },
      data:  { status: "COMPLETED" },
    });
    return count === 1;
  },

  /** Pendiente → cancelada, devolviendo el stock reservado. Idempotente. */
  async releasePendingSale(tx: Tx, saleId: number): Promise<boolean> {
    const { count } = await tx.sale.updateMany({
      where: { id: saleId, status: "PENDING_PAYMENT" },
      data:  { status: "CANCELLED" },
    });
    if (count === 0) return false;

    const items = await tx.saleItem.findMany({ where: { saleId } });
    for (const item of items) {
      await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
    }
    return true;
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
