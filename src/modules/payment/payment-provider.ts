// Contrato que cumple cada forma de cobro (efectivo, alias, QR, posnet…).
// El resto del sistema solo conoce esta interfaz: para sumar un proveedor nuevo
// (Mercado Pago, Ualá, un posnet integrado) se escribe un archivo en providers/
// y se registra en provider-registry.ts, sin tocar ventas ni pantallas.

export type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "QR" | "MIXED";
export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "TRANSFER", "QR", "MIXED"];

export type IntentStatus =
  | "PENDING"    // esperando que el cliente pague
  | "APPROVED"   // cobrado
  | "REJECTED"   // el proveedor lo rechazó
  | "CANCELLED"  // lo canceló el cajero
  | "EXPIRED"    // venció sin pago
  | "UNKNOWN";   // se perdió la respuesta: hay que consultar, nunca asumir que falló

export const OPEN_STATUSES: IntentStatus[] = ["PENDING", "UNKNOWN"];

/** Cómo se sabe que el cliente pagó */
export type Confirmation =
  | "immediate"  // en el momento (efectivo, posnet no integrado)
  | "automatic"  // el sistema le pregunta al proveedor (QR dinámico, posnet integrado)
  | "manual";    // un ADMIN lo confirma después de verificar la cuenta (alias)

export interface StartPaymentInput {
  reference:   string;  // única por intento; vincula el pago del proveedor con la venta
  amount:      number;
  description: string;
}

export interface ProviderResult {
  status:             IntentStatus;
  providerPaymentId?: string;
  paidAmount?:        number;  // lo que el proveedor dice que se cobró, para verificar el monto
  qrData?:            string;  // contenido del QR a mostrar
  reason?:            string;
}

export interface PaymentProvider {
  readonly name:         string;
  readonly method:       PaymentMethod;
  readonly confirmation: Confirmation;
  /** Minutos que el cobro puede quedar pendiente; null = sin vencimiento */
  readonly ttlMinutes:   number | null;

  start(input: StartPaymentInput): Promise<ProviderResult>;
  /** Obligatorio para proveedores "automatic" */
  checkStatus?(reference: string): Promise<ProviderResult>;
  /** Anula el cobro en el proveedor para que el cliente ya no pueda pagarlo */
  cancel?(reference: string): Promise<void>;
}
