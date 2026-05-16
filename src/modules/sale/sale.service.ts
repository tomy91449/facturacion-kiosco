import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CreateSaleInput {
  paymentMethod: string;
  customerId?: number;
  items: {
    productId: number;
    quantity: number;
  }[];
}

export class SaleService {
  static async createSale(data: CreateSaleInput) {
    // Usamos $transaction para que si algo falla, se cancele todo y no rompa el stock
    return await prisma.$transaction(async (tx) => {
      let total = 0;
      const saleItemsData = [];

      // 1. Validar productos, calcular precios y stock
      for (const item of data.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          throw new Error(`El producto con ID ${item.productId} no existe.`);
        }

        if (!product.active) {
          throw new Error(`El producto ${product.description} no está activo.`);
        }

        if (product.stock < item.quantity) {
          throw new Error(`Stock insuficiente para ${product.description}. Stock actual: ${product.stock}`);
        }

        // Calcular subtotal de este ítem
        const subtotal = product.price * item.quantity;
        total += subtotal;

        // Guardamos la info estructurada para el SaleItem
        saleItemsData.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice: product.price,
          subtotal: subtotal,
        });

        // 2. Descontar el stock del producto
        await tx.product.update({
          where: { id: product.id },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });
      }

      // 3. Crear la venta con sus respectivos ítems
      const newSale = await tx.sale.create({
        data: {
          paymentMethod: data.paymentMethod,
          customerId: data.customerId || null,
          total: total,
          grandTotal: total, // Si después agregás descuentos/impuestos, los aplicás acá
          status: 'COMPLETED',
          items: {
            create: saleItemsData,
          },
        },
        include: {
          items: true, // Para que nos devuelva la venta con los productos adentro
        },
      });

      return newSale;
    });
  }
}