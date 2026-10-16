import { PaymentMethod, PaymentProvider } from "./payment-provider";
import { cashProvider, cardStandaloneProvider, mixedProvider } from "./providers/immediate.provider";
import { manualTransferProvider } from "./providers/manual-transfer.provider";
import { qrSimulatorProvider } from "./providers/qr-simulator.provider";

/**
 * Qué proveedor atiende cada método de pago. Se decide por configuración (.env):
 *   QR_PROVIDER = simulator | (próximamente) mercadopago   — vacío = QR deshabilitado
 * El posnet (CARD) queda "no integrado" hasta sumar su adaptador.
 */
function qrProvider(): PaymentProvider | null {
  switch ((process.env.QR_PROVIDER ?? "").trim().toLowerCase()) {
    case "simulator": return qrSimulatorProvider;
    default:          return null;
  }
}

export function getProvider(method: PaymentMethod): PaymentProvider | null {
  switch (method) {
    case "CASH":     return cashProvider;
    case "CARD":     return cardStandaloneProvider;
    case "MIXED":    return mixedProvider;
    case "TRANSFER": return manualTransferProvider;
    case "QR":       return qrProvider();
  }
}

/** Proveedor con el que se creó un intento (puede no ser el configurado hoy) */
export function getProviderByName(name: string): PaymentProvider | null {
  const all = [cashProvider, cardStandaloneProvider, mixedProvider, manualTransferProvider, qrSimulatorProvider];
  return all.find((p) => p.name === name) ?? null;
}

export function isQrSimulatorActive(): boolean {
  return qrProvider() === qrSimulatorProvider;
}
