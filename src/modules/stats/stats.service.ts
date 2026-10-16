import { prisma } from "../../db";
import { ProductService, toCents } from "../sale/sale.service";

/** Día calendario en hora local, AAAA-MM-DD */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "AAAA-MM-DD" → medianoche local de ese día, o null si no es una fecha válida */
export function parseLocalDay(s: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localDay(d) === m[0] ? d : null;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER", "QR", "MIXED"] as const;

/**
 * Estadísticas de facturación entre from y to (ambos incluidos, días locales).
 * Solo cuentan las ventas COMPLETED; las anuladas se informan aparte.
 * storeId null = todos los locales.
 */
export const StatsService = {

  async getStats(storeId: number | null, from: Date, to: Date) {
    const start = from;
    const end   = addDays(to, 1); // exclusivo
    const days  = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    const prevStart = addDays(start, -days);
    const byStore   = storeId !== null ? { storeId } : {};

    const [sales, items, previous, cancelled, stores, lowStock] = await Promise.all([
      prisma.sale.findMany({
        where:  { ...byStore, status: "COMPLETED", date: { gte: start, lt: end } },
        select: { id: true, date: true, grandTotal: true, paymentMethod: true, storeId: true },
      }),
      prisma.saleItem.findMany({
        where:  { sale: { ...byStore, status: "COMPLETED", date: { gte: start, lt: end } } },
        select: {
          saleId: true, productId: true, quantity: true, subtotal: true, unitCost: true,
          product: { select: { description: true, cost: true, storeId: true } },
        },
      }),
      prisma.sale.findMany({
        where:  { ...byStore, status: "COMPLETED", date: { gte: prevStart, lt: start } },
        select: { id: true, grandTotal: true, items: { select: { quantity: true, unitCost: true, product: { select: { cost: true } } } } },
      }),
      prisma.sale.aggregate({
        where:  { ...byStore, status: "CANCELLED", date: { gte: start, lt: end } },
        _count: true, _sum: { grandTotal: true },
      }),
      prisma.store.findMany({ select: { id: true, name: true } }),
      ProductService.getLowStockProducts(storeId),
    ]);

    // Costo de cada venta: el guardado al vender, o el actual si la venta es anterior a ese dato
    const costBySale = new Map<number, number>();
    const products   = new Map<number, { description: string; storeId: number; units: number; revenue: number; cost: number }>();
    for (const it of items) {
      const cost = it.quantity * (it.unitCost ?? it.product.cost);
      costBySale.set(it.saleId, (costBySale.get(it.saleId) ?? 0) + cost);
      const p = products.get(it.productId) ?? { description: it.product.description, storeId: it.product.storeId, units: 0, revenue: 0, cost: 0 };
      p.units += it.quantity; p.revenue += it.subtotal; p.cost += cost;
      products.set(it.productId, p);
    }

    const dayIndex = new Map<string, { date: string; revenue: number; tickets: number }>();
    for (let i = 0; i < days; i++) {
      const date = localDay(addDays(start, i));
      dayIndex.set(date, { date, revenue: 0, tickets: 0 });
    }
    const byHour   = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, tickets: 0 }));
    const byMethod = new Map<string, { method: string; revenue: number; tickets: number }>(
      PAYMENT_METHODS.map((m) => [m, { method: m, revenue: 0, tickets: 0 }])
    );
    const storeNames = new Map(stores.map((s) => [s.id, s.name]));
    const byStoreMap = new Map<number, { storeId: number; name: string; revenue: number; tickets: number; profit: number }>();

    let revenue = 0, cost = 0;
    for (const s of sales) {
      const saleCost = costBySale.get(s.id) ?? 0;
      revenue += s.grandTotal; cost += saleCost;

      const day = dayIndex.get(localDay(s.date));
      if (day) { day.revenue += s.grandTotal; day.tickets++; }
      const hour = byHour[s.date.getHours()];
      hour.revenue += s.grandTotal; hour.tickets++;
      const method = byMethod.get(s.paymentMethod) ?? { method: s.paymentMethod, revenue: 0, tickets: 0 };
      method.revenue += s.grandTotal; method.tickets++;
      byMethod.set(s.paymentMethod, method);

      const st = byStoreMap.get(s.storeId) ?? { storeId: s.storeId, name: storeNames.get(s.storeId) ?? `Local ${s.storeId}`, revenue: 0, tickets: 0, profit: 0 };
      st.revenue += s.grandTotal; st.tickets++; st.profit += s.grandTotal - saleCost;
      byStoreMap.set(s.storeId, st);
    }

    const prevRevenue = previous.reduce((a, s) => a + s.grandTotal, 0);
    const prevCost    = previous.reduce((a, s) => a + s.items.reduce((b, it) => b + it.quantity * (it.unitCost ?? it.product.cost), 0), 0);
    const round = <T extends { revenue: number }>(r: T) => ({ ...r, revenue: toCents(r.revenue) });

    return {
      range: { from: localDay(start), to: localDay(to), days },
      totals: {
        revenue:   toCents(revenue),
        tickets:   sales.length,
        avgTicket: sales.length ? toCents(revenue / sales.length) : 0,
        cost:      toCents(cost),
        profit:    toCents(revenue - cost),
        marginPct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0,
        units:     items.reduce((a, it) => a + it.quantity, 0),
        cancelled: { count: cancelled._count, amount: toCents(cancelled._sum.grandTotal ?? 0) },
        lowStock:  lowStock.length,
      },
      previous: {
        from:    localDay(prevStart),
        to:      localDay(addDays(start, -1)),
        revenue: toCents(prevRevenue),
        tickets: previous.length,
        profit:  toCents(prevRevenue - prevCost),
      },
      byDay:           [...dayIndex.values()].map(round),
      byHour:          byHour.map(round),
      byPaymentMethod: [...byMethod.values()].map(round),
      byStore:         [...byStoreMap.values()].map((s) => ({ ...round(s), profit: toCents(s.profit) })).sort((a, b) => b.revenue - a.revenue),
      topProducts: [...products.entries()]
        .map(([productId, p]) => ({
          productId, description: p.description, storeName: storeNames.get(p.storeId) ?? "",
          units: p.units, revenue: toCents(p.revenue), profit: toCents(p.revenue - p.cost),
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10),
    };
  },
};
