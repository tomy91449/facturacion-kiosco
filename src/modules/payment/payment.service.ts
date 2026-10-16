import { randomBytes } from "crypto";
import { prisma } from "../../db";
import { Prisma, PaymentIntent } from "../../generated/client";
import { AuthUser } from "../auth/auth.service";
import { CreateSaleInput, SaleService } from "../sale/sale.service";
import { IntentStatus, OPEN_STATUSES, PaymentMethod } from "./payment-provider";
import { getProvider, getProviderByName, isQrSimulatorActive } from "./provider-registry";
import { qrSimulatorProvider } from "./providers/qr-simulator.provider";

export class PaymentError extends Error {
  constructor(message: string, readonly httpStatus = 422) {
    super(message);
  }
}

export interface CheckoutInput extends CreateSaleInput {
  paymentMethod:  PaymentMethod;
  idempotencyKey: string;
}

type IntentWithStore = PaymentIntent & { store: { name: string; transferAlias: string | null; transferHolder: string | null } };

const withStore = { store: { select: { name: true, transferAlias: true, transferHolder: true } } } as const;

/** Lo que ve la pantalla de cobro. Nunca incluye datos internos del proveedor. */
function toView(intent: IntentWithStore) {
  return {
    intentId:      intent.id,
    saleId:        intent.saleId,
    method:        intent.method,
    status:        intent.status as IntentStatus,
    amount:        intent.amount,
    qrData:        intent.qrData,
    expiresAt:     intent.expiresAt,
    failureReason: intent.failureReason,
    transfer:      intent.method === "TRANSFER"
      ? { alias: intent.store.transferAlias, holder: intent.store.transferHolder }
      : undefined,
    simulator:     intent.provider === "qr-simulator",
  };
}

export type PaymentView = ReturnType<typeof toView>;

const isOpen = (status: string) => (OPEN_STATUSES as string[]).includes(status);

async function loadIntent(id: number, storeId: number | null): Promise<IntentWithStore> {
  const intent = await prisma.paymentIntent.findUnique({ where: { id }, include: withStore });
  // Un cobro de otro local se trata igual que uno inexistente
  if (!intent || (storeId !== null && intent.storeId !== storeId)) throw new PaymentError("Cobro no encontrado", 404);
  return intent;
}

async function reload(id: number) {
  return prisma.paymentIntent.findUniqueOrThrow({ where: { id }, include: withStore });
}

// ── Transiciones de estado ───────────────────
// Todas son condicionales (solo actúan si el intento sigue abierto), así que
// dos consultas simultáneas nunca completan ni cancelan una venta dos veces.

async function approve(intent: PaymentIntent, extra: { providerPaymentId?: string; confirmedById?: number }) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.paymentIntent.updateMany({
      where: { id: intent.id, status: { in: OPEN_STATUSES } },
      data:  { status: "APPROVED", resolvedAt: new Date(), failureReason: null, ...extra },
    });
    if (count === 0) return;

    const completed = await SaleService.completePendingSale(tx, intent.saleId);
    if (!completed) {
      // El cliente pagó una venta que ya se había cancelado: la plata entró, hay que devolverla
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data:  { failureReason: "Pago recibido sobre una venta cancelada: revisar y devolver el dinero" },
      });
    }
  });
}

async function close(intent: PaymentIntent, status: "REJECTED" | "CANCELLED" | "EXPIRED", reason: string, userId?: number) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.paymentIntent.updateMany({
      where: { id: intent.id, status: { in: OPEN_STATUSES } },
      data:  { status, failureReason: reason, resolvedAt: new Date(), ...(userId && { confirmedById: userId }) },
    });
    if (count === 1) await SaleService.releasePendingSale(tx, intent.saleId);
  });
}

async function markUnknown(intent: PaymentIntent, reason: string) {
  await prisma.paymentIntent.updateMany({
    where: { id: intent.id, status: { in: OPEN_STATUSES } },
    data:  { status: "UNKNOWN", failureReason: reason },
  });
}

/**
 * Pregunta al proveedor cómo está un cobro abierto y aplica el resultado.
 * Si el proveedor no responde, el cobro queda UNKNOWN: puede que el cliente haya pagado.
 */
async function refresh(intent: PaymentIntent): Promise<void> {
  if (!isOpen(intent.status)) return;
  const provider = getProviderByName(intent.provider);
  if (!provider || provider.confirmation !== "automatic" || !provider.checkStatus) return;

  let result;
  try {
    result = await provider.checkStatus(intent.reference);
  } catch {
    return markUnknown(intent, "Sin respuesta del proveedor de pago. Se vuelve a consultar sola.");
  }

  if (result.status === "APPROVED") {
    if (result.paidAmount !== undefined && Math.abs(result.paidAmount - intent.amount) > 0.009) {
      return markUnknown(intent, `El monto pagado ($${result.paidAmount}) no coincide con la venta ($${intent.amount}). Revisar.`);
    }
    return approve(intent, { providerPaymentId: result.providerPaymentId });
  }

  if (result.status === "REJECTED") return close(intent, "REJECTED", result.reason ?? "Pago rechazado");

  if (result.status === "PENDING" && intent.expiresAt && intent.expiresAt < new Date()) {
    try {
      await provider.cancel?.(intent.reference);
      // Última consulta: el cliente pudo haber pagado justo antes de anular
      const last = await provider.checkStatus(intent.reference);
      if (last.status === "APPROVED") return approve(intent, { providerPaymentId: last.providerPaymentId });
    } catch {
      return markUnknown(intent, "No se pudo anular el cobro vencido en el proveedor. Se reintenta solo.");
    }
    return close(intent, "EXPIRED", "Venció sin que el cliente pague");
  }

  if (result.status === "PENDING" && intent.status === "UNKNOWN") {
    await prisma.paymentIntent.updateMany({
      where: { id: intent.id, status: "UNKNOWN" },
      data:  { status: "PENDING", failureReason: null },
    });
  }
}

// ── API del servicio ─────────────────────────

export const PaymentService = {

  /**
   * Crea la venta y su cobro. Efectivo y posnet no integrado quedan completados al instante;
   * alias y QR dejan la venta PENDIENTE con el stock reservado hasta confirmar el pago.
   * Reintentar con la misma idempotencyKey devuelve el mismo cobro en lugar de duplicar la venta.
   */
  async checkout(user: AuthUser, storeId: number, input: CheckoutInput): Promise<PaymentView> {
    const existing = await prisma.paymentIntent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: withStore });
    if (existing) {
      if (existing.storeId !== storeId) throw new PaymentError("Clave de cobro inválida", 409);
      return toView(existing);
    }

    const provider = getProvider(input.paymentMethod);
    if (!provider) throw new PaymentError("El cobro con QR no está configurado (QR_PROVIDER en el .env)");

    if (input.paymentMethod === "TRANSFER") {
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store?.transferAlias) throw new PaymentError("Este local no tiene alias para transferencias. Configuralo en Administración.");
    }

    const prepared = await SaleService.prepareSale(storeId, input);
    if ("error" in prepared) throw new PaymentError(prepared.error);
    const { draft } = prepared;

    const immediate = provider.confirmation === "immediate";
    let intent: PaymentIntent;
    try {
      intent = await prisma.$transaction(async (tx) => {
        const sale = await SaleService.createSale(tx, draft, immediate ? "COMPLETED" : "PENDING_PAYMENT");
        return tx.paymentIntent.create({
          data: {
            saleId:         sale.id,
            storeId,
            method:         input.paymentMethod,
            provider:       provider.name,
            status:         immediate ? "APPROVED" : "PENDING",
            amount:         draft.grandTotal,
            reference:      `venta-${sale.id}-${randomBytes(4).toString("hex")}`,
            idempotencyKey: input.idempotencyKey,
            createdById:    user.id,
            resolvedAt:     immediate ? new Date() : null,
            expiresAt:      provider.ttlMinutes ? new Date(Date.now() + provider.ttlMinutes * 60_000) : null,
          },
        });
      });
    } catch (err) {
      // Dos clics simultáneos con la misma clave: el segundo devuelve el cobro del primero
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.paymentIntent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: withStore });
        if (winner && winner.storeId === storeId) return toView(winner);
      }
      if (err instanceof Error && err.message.startsWith("Stock insuficiente")) throw new PaymentError(err.message);
      throw err;
    }

    if (!immediate) {
      try {
        const result = await provider.start({
          reference:   intent.reference,
          amount:      intent.amount,
          description: `Venta #${intent.saleId}`,
        });
        await prisma.paymentIntent.update({
          where: { id: intent.id },
          data:  { qrData: result.qrData ?? null, providerPaymentId: result.providerPaymentId ?? null },
        });
        if (result.status === "APPROVED") await approve(intent, { providerPaymentId: result.providerPaymentId });
      } catch {
        // No sabemos si el proveedor registró el cobro: se consulta más tarde, no se cancela a ciegas
        await markUnknown(intent, "No se pudo confirmar el inicio del cobro con el proveedor. Se vuelve a consultar sola.");
      }
    }

    return toView(await reload(intent.id));
  },

  /** Estado actual del cobro. Para QR consulta al proveedor en el momento. */
  async getStatus(storeId: number | null, intentId: number): Promise<PaymentView> {
    const intent = await loadIntent(intentId, storeId);
    await refresh(intent);
    return toView(await reload(intent.id));
  },

  /** El cliente se fue o eligió otro medio: anula el cobro y libera el stock. */
  async cancel(user: AuthUser, storeId: number | null, intentId: number): Promise<PaymentView> {
    const intent = await loadIntent(intentId, storeId);
    if (!isOpen(intent.status)) throw new PaymentError("Este cobro ya está cerrado");

    // Antes de anular, confirmar que el cliente no haya pagado recién
    await refresh(intent);
    const current = await reload(intent.id);
    if (current.status === "APPROVED") return toView(current);
    if (current.status === "UNKNOWN" && user.role !== "ADMIN") {
      throw new PaymentError("No se sabe si el cliente pagó. Esperá unos segundos o pedile a un administrador que lo revise.");
    }
    if (!isOpen(current.status)) return toView(current);

    try {
      await getProviderByName(current.provider)?.cancel?.(current.reference);
    } catch {
      throw new PaymentError("No se pudo anular el cobro en el proveedor. Reintentá en unos segundos.", 502);
    }
    await close(current, "CANCELLED", `Cancelado por ${user.username}`, user.id);
    return toView(await reload(intent.id));
  },

  /** Solo ADMIN: confirma una transferencia después de verlo acreditado en la cuenta. */
  async confirmManual(admin: AuthUser, intentId: number): Promise<PaymentView> {
    const intent = await loadIntent(intentId, null);
    if (getProviderByName(intent.provider)?.confirmation !== "manual") {
      throw new PaymentError("Este cobro se confirma automáticamente con el proveedor, no a mano");
    }
    if (!isOpen(intent.status)) throw new PaymentError("Este cobro ya está cerrado");
    await approve(intent, { confirmedById: admin.id });
    return toView(await reload(intent.id));
  },

  /** Cobros que necesitan atención: pendientes, sin respuesta o pagados sobre una venta cancelada. */
  async listOpen(storeId: number | null) {
    const intents = await prisma.paymentIntent.findMany({
      where: {
        ...(storeId !== null && { storeId }),
        OR: [{ status: { in: OPEN_STATUSES } }, { status: "APPROVED", failureReason: { not: null } }],
      },
      include: withStore,
      orderBy: { createdAt: "asc" },
    });
    return intents.map((i) => ({ ...toView(i), storeName: i.store.name, createdAt: i.createdAt }));
  },

  /** Solo con QR_PROVIDER=simulator: hace de cuenta que el cliente pagó (o le rechazaron) el QR. */
  async simulate(intentId: number, outcome: "approve" | "reject"): Promise<PaymentView> {
    if (!isQrSimulatorActive()) throw new PaymentError("El simulador de QR no está activo", 404);
    const intent = await loadIntent(intentId, null);
    if (intent.provider !== qrSimulatorProvider.name || !qrSimulatorProvider.simulate(intent.reference, outcome)) {
      throw new PaymentError("Ese cobro no está pendiente en el simulador");
    }
    await refresh(intent);
    return toView(await reload(intent.id));
  },

  /**
   * Revisa en segundo plano los cobros automáticos abiertos: confirma los pagados aunque
   * nadie tenga la pantalla abierta y vence los abandonados (liberando su stock).
   */
  startSweeper(intervalMs = 30_000) {
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const open = await prisma.paymentIntent.findMany({ where: { status: { in: OPEN_STATUSES } } });
        for (const intent of open) await refresh(intent);
      } catch (err) {
        console.error("[Pagos] Error revisando cobros abiertos:", err instanceof Error ? err.message : err);
      } finally {
        running = false;
      }
    }, intervalMs);
    timer.unref();
  },
};
