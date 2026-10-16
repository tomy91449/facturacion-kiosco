import { IntentStatus, PaymentProvider } from "../payment-provider";

/**
 * QR de mentira para desarrollar y probar sin cuenta de Mercado Pago.
 * Se comporta como un proveedor real: el cobro queda pendiente y el sistema consulta
 * su estado hasta que alguien "paga" con el endpoint de simulación (solo ADMIN).
 * Se activa con QR_PROVIDER=simulator. Nunca usarlo para cobrar de verdad.
 */
const payments = new Map<string, { status: IntentStatus; amount: number }>();

export const qrSimulatorProvider: PaymentProvider & {
  simulate(reference: string, outcome: "approve" | "reject"): boolean;
} = {
  name:         "qr-simulator",
  method:       "QR",
  confirmation: "automatic",
  ttlMinutes:   10,

  async start({ reference, amount }) {
    payments.set(reference, { status: "PENDING", amount });
    return { status: "PENDING", qrData: `SIMULADOR|${reference}|${amount.toFixed(2)}` };
  },

  async checkStatus(reference) {
    const p = payments.get(reference);
    // Si el servidor se reinició, el simulador "perdió" el pago: queda pendiente y vence solo
    if (!p) return { status: "PENDING" };
    return {
      status:            p.status,
      paidAmount:        p.status === "APPROVED" ? p.amount : undefined,
      providerPaymentId: p.status === "APPROVED" ? `SIM-${reference}` : undefined,
      reason:            p.status === "REJECTED" ? "Pago rechazado (simulado)" : undefined,
    };
  },

  async cancel(reference) {
    const p = payments.get(reference);
    if (p?.status === "PENDING") p.status = "CANCELLED";
  },

  simulate(reference, outcome) {
    const p = payments.get(reference);
    if (!p || p.status !== "PENDING") return false;
    p.status = outcome === "approve" ? "APPROVED" : "REJECTED";
    return true;
  },
};
