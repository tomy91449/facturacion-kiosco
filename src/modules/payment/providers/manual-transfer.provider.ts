import { PaymentProvider } from "../payment-provider";

/**
 * Transferencia al alias del local. Una transferencia no trae ninguna referencia de la venta,
 * así que el sistema no puede confirmarla solo: queda pendiente hasta que un ADMIN
 * verifica la cuenta y la confirma. El cajero nunca puede marcarla como pagada.
 */
export const manualTransferProvider: PaymentProvider = {
  name:         "manual-transfer",
  method:       "TRANSFER",
  confirmation: "manual",
  ttlMinutes:   null,
  async start() {
    return { status: "PENDING" };
  },
};
