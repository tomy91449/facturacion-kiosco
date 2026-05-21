"use strict";
/**
 * ============================================================
 * MÓDULO DE IMPRESIÓN ESC/POS — Datalogic & Térmicas Genéricas
 * ============================================================
 * Compatible con:
 *  - Datalogic Magellan/Gryphon series (modo impresora ESC/POS)
 *  - Epson TM series, Star Micronics, Bixolon, Citizen, etc.
 *  - Cualquier dispositivo que soporte el protocolo ESC/POS estándar
 *
 * Transporte soportado:
 *  - USB (node-usb / driver nativo del OS como dispositivo serial)
 *  - TCP/IP socket (impresoras en red)
 *  - Bluetooth serial (COM port virtual)
 * ============================================================
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POSPrinter = void 0;
exports.createPrinter = createPrinter;
const net_1 = __importDefault(require("net"));
const serialport_1 = require("serialport"); // npm install serialport
// ─────────────────────────────────────────────
// COMANDOS ESC/POS (bytes de control)
// Referencia: Epson ESC/POS Application Programming Guide
// ─────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const CMD = {
    INIT: Buffer.from([ESC, 0x40]), // Inicializar impresora (reset)
    BOLD_ON: Buffer.from([ESC, 0x45, 0x01]), // Negrita activada
    BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]), // Negrita desactivada
    UNDERLINE_ON: Buffer.from([ESC, 0x2d, 0x01]), // Subrayado activado
    UNDERLINE_OFF: Buffer.from([ESC, 0x2d, 0x00]), // Subrayado desactivado
    ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]), // Alineación izquierda
    ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]), // Alineación centro
    ALIGN_RIGHT: Buffer.from([ESC, 0x61, 0x02]), // Alineación derecha
    FONT_NORMAL: Buffer.from([ESC, 0x21, 0x00]), // Tamaño normal
    FONT_DOUBLE_H: Buffer.from([ESC, 0x21, 0x10]), // Doble alto
    FONT_DOUBLE: Buffer.from([ESC, 0x21, 0x30]), // Doble alto + ancho
    LINE_FEED: Buffer.from([0x0a]), // Nueva línea
    CUT_FULL: Buffer.from([GS, 0x56, 0x00]), // Corte total de papel
    CUT_PARTIAL: Buffer.from([GS, 0x56, 0x01]), // Corte parcial (recomendado)
    OPEN_DRAWER: Buffer.from([ESC, 0x70, 0x00, 0x3c, 0x78]), // Abrir cajón monedero
    BEEP: Buffer.from([ESC, 0x42, 0x03, 0x01]), // Pitido de confirmación
};
// ─────────────────────────────────────────────
// CLASE PRINCIPAL DE IMPRESIÓN
// ─────────────────────────────────────────────
class POSPrinter {
    constructor(config) {
        this.buffer = [];
        // Valores por defecto
        this.config = {
            type: config.type,
            host: config.host ?? "192.168.1.100",
            port: config.port ?? 9100,
            path: config.path ?? "/dev/usb/lp0",
            baudRate: config.baudRate ?? 9600,
            paperWidth: config.paperWidth ?? 48, // 80mm por defecto
            storeName: config.storeName ?? "MI COMERCIO",
            storeAddress: config.storeAddress ?? "Dirección 123, Ciudad",
            storePhone: config.storePhone ?? "Tel: (011) 1234-5678",
            taxId: config.taxId ?? "",
            footer: config.footer ?? "¡Gracias por su compra!",
        };
    }
    // ─────────────────────────────────────────
    // HELPERS DE FORMATEO
    // ─────────────────────────────────────────
    /** Agrega bytes al buffer de impresión */
    write(...chunks) {
        for (const chunk of chunks) {
            this.buffer.push(typeof chunk === "string"
                ? Buffer.from(chunk + "\n", "latin1")
                : chunk);
        }
        return this;
    }
    /**
     * Formatea una línea de dos columnas (producto | precio)
     * con relleno de puntos para alineación en papel térmico.
     * Ejemplo: "Gaseosa Cola 1.5L ........ $1.250,00"
     */
    formatLine(left, right, fillChar = " ") {
        const total = this.config.paperWidth;
        // Truncar izquierda si es muy largo
        const maxLeft = total - right.length - 2;
        const truncLeft = left.length > maxLeft
            ? left.substring(0, maxLeft - 1) + "…"
            : left;
        const fill = fillChar.repeat(total - truncLeft.length - right.length);
        return truncLeft + fill + right;
    }
    /** Línea separadora de guiones */
    separator(char = "-") {
        return this.write(char.repeat(this.config.paperWidth));
    }
    /** Línea en blanco */
    newLine(count = 1) {
        for (let i = 0; i < count; i++)
            this.write(CMD.LINE_FEED);
        return this;
    }
    // ─────────────────────────────────────────
    // CONSTRUCCIÓN DEL TICKET
    // ─────────────────────────────────────────
    /**
     * Construye el ticket completo de una venta en el buffer ESC/POS.
     * Retorna `this` para encadenamiento fluido.
     */
    buildTicket(sale) {
        this.buffer = []; // Limpiar buffer previo
        const w = this.config.paperWidth;
        // ── 1. Inicialización ──
        this.write(CMD.INIT);
        // ── 2. Encabezado del comercio ──
        this.write(CMD.ALIGN_CENTER);
        this.write(CMD.BOLD_ON, CMD.FONT_DOUBLE_H);
        this.write(this.config.storeName);
        this.write(CMD.BOLD_OFF, CMD.FONT_NORMAL);
        this.write(this.config.storeAddress);
        this.write(this.config.storePhone);
        if (this.config.taxId) {
            this.write(`CUIT/RUC: ${this.config.taxId}`);
        }
        // ── 3. Datos del comprobante ──
        this.newLine();
        this.write(CMD.ALIGN_LEFT);
        this.separator("=");
        const dateStr = new Date(sale.date).toLocaleString("es-AR", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
        this.write(`Ticket N°: ${String(sale.id).padStart(8, "0")}`);
        this.write(`Fecha    : ${dateStr}`);
        this.write(`Pago     : ${formatPaymentMethod(sale.paymentMethod)}`);
        if (sale.customer) {
            this.write(`Cliente  : ${sale.customer.name}`);
            if (sale.customer.taxId) {
                this.write(`Doc.     : ${sale.customer.taxId}`);
            }
        }
        // ── 4. Líneas de productos ──
        this.separator("-");
        this.write(this.formatLine("DESCRIPCIÓN", "PRECIO"));
        this.separator("-");
        for (const item of sale.items) {
            // Primera línea: nombre del producto
            this.write(`${item.quantity}x ${item.product.description}`);
            // Segunda línea: precio unitario y subtotal alineados
            this.write(this.formatLine(`   @ ${formatCurrency(item.unitPrice)} c/u`, formatCurrency(item.subtotal)));
        }
        // ── 5. Totales (en negrita) ──
        this.separator("-");
        if (sale.discount > 0) {
            this.write(this.formatLine("Subtotal:", formatCurrency(sale.total)));
            this.write(this.formatLine("Descuento:", `-${formatCurrency(sale.discount)}`));
        }
        if (sale.tax > 0) {
            this.write(this.formatLine("IVA/Impuesto:", formatCurrency(sale.tax)));
        }
        this.separator("=");
        // TOTAL en doble tamaño para máxima visibilidad
        this.write(CMD.ALIGN_RIGHT, CMD.BOLD_ON, CMD.FONT_DOUBLE_H);
        this.write(`TOTAL: ${formatCurrency(sale.grandTotal)}`);
        this.write(CMD.BOLD_OFF, CMD.FONT_NORMAL);
        this.separator("=");
        // ── 6. Pie del ticket ──
        this.write(CMD.ALIGN_CENTER);
        this.newLine();
        this.write(this.config.footer);
        this.newLine(3); // Espacio para el corte
        // ── 7. Corte de papel (parcial) ──
        this.write(CMD.CUT_PARTIAL);
        return this;
    }
    /**
     * Construye el buffer final concatenando todos los chunks.
     */
    getBuffer() {
        return Buffer.concat(this.buffer);
    }
    // ─────────────────────────────────────────
    // MÉTODOS DE ENVÍO
    // ─────────────────────────────────────────
    /**
     * Envía el buffer a una impresora por TCP/IP socket.
     * Ideal para impresoras en red (WiFi o Ethernet).
     * Puerto estándar ESC/POS: 9100.
     */
    sendViaTCP() {
        return new Promise((resolve, reject) => {
            const socket = new net_1.default.Socket();
            const data = this.getBuffer();
            socket.setTimeout(5000); // timeout de 5 segundos
            socket.connect(this.config.port, this.config.host, () => {
                socket.write(data, (err) => {
                    socket.end();
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            socket.on("error", reject);
            socket.on("timeout", () => {
                socket.destroy();
                reject(new Error(`Timeout conectando a ${this.config.host}:${this.config.port}`));
            });
        });
    }
    /**
     * Envía el buffer a una impresora serial / USB-Serial.
     * En Linux los dispositivos USB suelen aparecer como /dev/usb/lp0
     * o /dev/ttyUSB0. En Windows como COM3, COM4, etc.
     */
    sendViaSerial() {
        return new Promise((resolve, reject) => {
            const port = new serialport_1.SerialPort({
                path: this.config.path,
                baudRate: this.config.baudRate,
            });
            port.open((err) => {
                if (err)
                    return reject(err);
                const data = this.getBuffer();
                port.write(data, (writeErr) => {
                    port.drain(() => {
                        port.close((closeErr) => {
                            if (writeErr || closeErr)
                                reject(writeErr ?? closeErr);
                            else
                                resolve();
                        });
                    });
                });
            });
        });
    }
    /**
     * Punto de entrada unificado.
     * Selecciona automáticamente el transporte configurado.
     */
    async print() {
        const data = this.getBuffer();
        try {
            if (this.config.type === "tcp") {
                await this.sendViaTCP();
            }
            else {
                await this.sendViaSerial();
            }
            return { success: true, bytes: data.length };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Error desconocido";
            console.error(`[PrintService] Error de impresión: ${message}`);
            return { success: false, bytes: 0, error: message };
        }
    }
    /**
     * Abre el cajón portamonedas (cash drawer) conectado a la impresora.
     * Requiere que el cajón esté conectado al puerto RJ-11 de la impresora.
     */
    async openDrawer() {
        this.buffer = [CMD.OPEN_DRAWER];
        await this.print();
    }
}
exports.POSPrinter = POSPrinter;
// ─────────────────────────────────────────────
// HELPERS DE FORMATO
// ─────────────────────────────────────────────
/** Formatea un número como moneda local */
function formatCurrency(amount) {
    return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        minimumFractionDigits: 2,
    }).format(amount);
}
/** Traduce el enum de método de pago a texto legible */
function formatPaymentMethod(method) {
    const map = {
        CASH: "Efectivo",
        CARD: "Tarjeta",
        TRANSFER: "Transferencia",
        QR: "QR / Billetera digital",
        MIXED: "Pago mixto",
    };
    return map[method] ?? method;
}
// ─────────────────────────────────────────────
// FACTORY — instancia lista para usar
// ─────────────────────────────────────────────
/** Retorna una instancia configurada desde variables de entorno */
function createPrinter() {
    return new POSPrinter({
        type: (process.env.PRINTER_TYPE ?? "tcp"),
        host: process.env.PRINTER_HOST ?? "192.168.1.100",
        port: Number(process.env.PRINTER_PORT ?? 9100),
        path: process.env.PRINTER_PATH ?? "/dev/usb/lp0",
        baudRate: Number(process.env.PRINTER_BAUD ?? 9600),
        paperWidth: Number(process.env.PAPER_WIDTH ?? 48),
        storeName: process.env.STORE_NAME,
        storeAddress: process.env.STORE_ADDRESS,
        storePhone: process.env.STORE_PHONE,
        taxId: process.env.STORE_TAX_ID,
        footer: process.env.TICKET_FOOTER ?? "¡Gracias por su compra!",
    });
}
