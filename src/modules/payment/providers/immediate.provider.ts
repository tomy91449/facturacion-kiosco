import { PaymentMethod, PaymentProvider } from "../payment-provider";

/**
 * Cobros que se resuelven en el mostrador: el cajero recibe el pago y la venta se completa.
 * - CASH:  efectivo.
 * - CARD:  posnet NO integrado (el cajero tipea el monto en el posnet y cobra ahí).
 * - MIXED: parte en efectivo y parte con otro medio, resuelto en el mostrador.
 *
 * Para integrar un posnet: crear providers/<marca>-posnet.provider.ts con
 * confirmation "automatic" (como el QR) y registrarlo para CARD en provider-registry.ts.
 */
function immediateProvider(name: string, method: PaymentMethod): PaymentProvider {
  return {
    name,
    method,
    confirmation: "immediate",
    ttlMinutes:   null,
    async start() {
      return { status: "APPROVED" };
    },
  };
}

export const cashProvider           = immediateProvider("cash", "CASH");
export const cardStandaloneProvider = immediateProvider("card-standalone", "CARD");
export const mixedProvider          = immediateProvider("mixed", "MIXED");
