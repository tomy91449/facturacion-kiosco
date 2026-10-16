import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CheckoutInput, PaymentError, PaymentService } from "../modules/payment/payment.service";
import { PAYMENT_METHODS, PaymentMethod } from "../modules/payment/payment-provider";
import { getProvider, isQrSimulatorActive } from "../modules/payment/provider-registry";
import { requireRole } from "./auth.middleware";
import { asyncHandler, readStoreScope, requireStoreScope } from "./store-scope";

export const paymentRouter = Router();

const onlyAdmin = requireRole("ADMIN");
const idParam   = z.coerce.number().int().positive();

const checkoutSchema = z.object({
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity:  z.number().int().positive().max(10_000),
  })).min(1, "La venta debe tener al menos un ítem").max(500),
  paymentMethod:  z.enum(PAYMENT_METHODS as [PaymentMethod, ...PaymentMethod[]]),
  // La genera el navegador por cada cobro (crypto.randomUUID)
  idempotencyKey: z.string().min(16).max(100),
  customerId:     z.number().int().positive().optional(),
  discount:       z.number().min(0).optional(),
  notes:          z.string().max(500).optional(),
});

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Datos inválidos";
}

/** Métodos de pago disponibles hoy, para que la pantalla muestre solo los que funcionan. */
paymentRouter.get("/payments/methods", (_req, res) => {
  const methods = PAYMENT_METHODS.map((method) => {
    const provider = getProvider(method);
    return { method, enabled: provider !== null, confirmation: provider?.confirmation ?? null };
  });
  res.json({ success: true, data: { methods, qrSimulator: isQrSimulatorActive() } });
});

/** Cobrar: crea la venta y su intento de pago. */
paymentRouter.post(
  "/sales",
  asyncHandler(async (req, res) => {
    const storeId = await requireStoreScope(req, res);
    if (storeId === null) return;

    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: firstIssue(parsed.error) });

    const payment = await PaymentService.checkout(req.user!, storeId, parsed.data as CheckoutInput);
    return res.status(201).json({ success: true, saleId: payment.saleId, grandTotal: payment.amount, payment });
  })
);

/** Cobros que necesitan atención (transferencias a confirmar, sin respuesta del proveedor, etc.) */
paymentRouter.get(
  "/payments/open",
  asyncHandler(async (req, res) => {
    const data = await PaymentService.listOpen(readStoreScope(req));
    return res.json({ success: true, data });
  })
);

paymentRouter.get(
  "/payments/:id",
  asyncHandler(async (req, res) => {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ success: false, error: "Id inválido" });
    const payment = await PaymentService.getStatus(readStoreScope(req), id.data);
    return res.json({ success: true, data: payment });
  })
);

paymentRouter.post(
  "/payments/:id/cancel",
  asyncHandler(async (req, res) => {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ success: false, error: "Id inválido" });
    const payment = await PaymentService.cancel(req.user!, readStoreScope(req), id.data);
    return res.json({ success: true, data: payment });
  })
);

/** Solo ADMIN: confirmar una transferencia al alias después de verla en la cuenta. */
paymentRouter.post(
  "/payments/:id/confirm",
  onlyAdmin,
  asyncHandler(async (req, res) => {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ success: false, error: "Id inválido" });
    const payment = await PaymentService.confirmManual(req.user!, id.data);
    return res.json({ success: true, data: payment });
  })
);

/** Solo ADMIN y con QR_PROVIDER=simulator: simula que el cliente pagó o le rechazaron el QR. */
paymentRouter.post(
  "/payments/:id/simulate",
  onlyAdmin,
  asyncHandler(async (req, res) => {
    const id      = idParam.safeParse(req.params.id);
    const outcome = z.enum(["approve", "reject"]).safeParse(req.body?.outcome);
    if (!id.success || !outcome.success) return res.status(400).json({ success: false, error: "Datos inválidos" });
    const payment = await PaymentService.simulate(id.data, outcome.data);
    return res.json({ success: true, data: payment });
  })
);

paymentRouter.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof PaymentError) return res.status(err.httpStatus).json({ success: false, error: err.message });
  next(err);
});
