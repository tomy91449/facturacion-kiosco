# Sistema de Facturación y Control para Kioscos 🛒

Sistema desarrollado para agilizar el proceso de cobro, lectura de productos mediante código de barras y gestión de ventas en comercios minoristas. Integra tecnologías modernas para la automatización de procesos y control de caja.

## 🚀 Características Principales
- **Lectura por Código de Barras:** Identificación rápida de artículos para un cobro ágil.
- **Carrito de Ventas Dinámico:** Cálculo automático de subtotales, cantidades y montos totales a pagar.
- **Múltiples Medios de Pago:** Registro y clasificación de cobros en efectivo, transferencias/billeteras virtuales y tarjetas.
- **Arquitectura Escalable:** Estructura limpia separada en componentes lógicos para facilitar su mantenimiento e integración.

## 🛠️ Tecnologías Utilizadas
- **Node.js:** Lógica del servidor, manejo de eventos y procesamiento de la pasarela local.
- **Google Apps Script (GAS):** Automatización en la nube y gestión de planillas de respaldo/datos.
- **JavaScript:** Lenguaje principal del proyecto.

## ⚙️ Configuración e Instalación local
1. Clona el repositorio:
   ```bash
   git clone https://github.com/tomy91449/facturacionKiosco.git
   ```
2. Instalá dependencias (también genera el cliente Prisma):
   ```bash
   npm install
   ```
3. Copiá `.env.example` como `.env` y completá los valores. `JWT_SECRET` es obligatorio:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
4. Aplicá las migraciones y arrancá:
   ```bash
   npx prisma migrate deploy
   npm run build && npm run electron
   ```

## 🐳 Despliegue con Docker

1. Creá el `.env` a partir de `.env.example` con `JWT_SECRET`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`.
2. Levantá el contenedor:
   ```bash
   docker compose up -d --build
   ```
3. Entrá desde cualquier PC de la red a `http://<ip-del-servidor>:4000` con el usuario administrador.
4. En **Administración**, creá un local por cada sucursal y un usuario cajero para cada uno.

La base de datos queda en el volumen `kiosco-data`, así que sobrevive a las actualizaciones
(`docker compose up -d --build` aplica las migraciones nuevas al arrancar).

> Si el servidor va a ser accesible desde Internet, ponelo detrás de un proxy con HTTPS
> (por ejemplo Caddy o Nginx): sin HTTPS, usuario, contraseña y token viajan en texto plano.

## 💻 Programa de escritorio (.exe) con licencia por PC

Un instalador de Windows que corre todo en la PC del cliente, sin Docker ni internet.

**Armar el instalador:**
```bash
npm run dist
```
Queda en `release/Kiosco Domingo Setup <versión>.exe`. Para una versión nueva, subí `version` en `package.json`.

**Licencias** (la primera vez: `npm run licencia -- crear-claves`):
1. El cliente instala y abre el programa: le aparece un código del equipo (`KD-XXXX-XXXX-XXXX`).
2. Generás su clave: `npm run licencia -- KD-XXXX-XXXX-XXXX "Nombre del cliente"`.
3. El cliente la pega y queda activado para siempre en esa PC.

La clave privada vive en `%USERPROFILE%\KioscoDomingo-licencias` (fuera del repo, junto a `registro.csv`
con las licencias emitidas). **Guardá una copia fuera de la PC**: si se pierde, los instaladores ya
entregados no se pueden activar en equipos nuevos.

**Datos del cliente:** `%APPDATA%\Kiosco Domingo\datos` (base `pos.db`, respaldos diarios de los últimos
30 días en `respaldos\`, impresora y datos del ticket en `configuracion.env`, errores en `registro.log`).
Desinstalar o actualizar el programa no los borra. La primera vez se crea el administrador desde la pantalla.

> Sin certificado de firma de código, Windows muestra "Windows protegió su PC" al instalar:
> "Más información" → "Ejecutar de todas formas".

## 👥 Usuarios y locales

| Rol | Qué puede hacer |
|-----|-----------------|
| **Administrador** | Crear, habilitar y deshabilitar locales; crear y editar usuarios (nombre, perfil, local y contraseña); ver las estadísticas de todos los locales u operar en uno eligiéndolo arriba a la derecha. |
| **Cajero** | Vender, cargar productos y ver el cierre de caja **solo de su local**. |

Deshabilitar un local corta al instante el acceso de sus cajeros; sus ventas se conservan. Siempre queda
al menos un administrador activo, y nadie puede quitarse a sí mismo el perfil de administrador.

**Estadísticas** (pestaña del administrador, `GET /stats?from=AAAA-MM-DD&to=AAAA-MM-DD`): facturación,
ganancia bruta y margen comparados con el período anterior, tickets y ticket promedio, ventas anuladas,
stock bajo, facturación por día, por hora, por medio de pago y por local, y los 10 productos que más
facturan. La ganancia usa el costo guardado en cada venta (`sale_items.unit_cost`); las ventas
anteriores a ese dato usan el costo actual del producto.

Toda la API exige el header `Authorization: Bearer <token>`, que se obtiene en `POST /auth/login`.

## 💳 Medios de pago

| Método | Cómo se confirma |
|--------|------------------|
| **Efectivo, Tarjeta (posnet no integrado), Mixto** | Al instante, en el mostrador. |
| **QR** | Automático: el sistema genera un QR por venta y consulta al proveedor hasta saber si se pagó. Vence a los 10 minutos. |
| **Alias** | Manual: la venta queda pendiente y **solo un administrador** la confirma después de ver la transferencia en la cuenta. |

- Mientras un cobro está pendiente, la venta queda en `PENDING_PAYMENT` con el stock **reservado**.
  Si se cancela, se rechaza o vence, la venta se anula y el stock vuelve.
- El cierre de caja solo suma ventas cobradas.
- El alias y el titular se configuran por local en **Administración → Alias para transferencias**.
- **Cobros pendientes** (en Administración) lista transferencias por confirmar y cobros sin respuesta del proveedor.

### QR

Se elige con `QR_PROVIDER` en el `.env`:

- vacío: QR deshabilitado.
- `simulator`: QR de **prueba**, no entra dinero. El administrador ve botones para simular el pago o el rechazo.

### Agregar un proveedor (Mercado Pago, Ualá, un posnet integrado)

Cada medio de pago implementa la interfaz `PaymentProvider` (`src/modules/payment/payment-provider.ts`).
Para sumar uno nuevo:

1. Crear `src/modules/payment/providers/<nombre>.provider.ts` con `start`, `checkStatus` y `cancel`.
2. Registrarlo en `src/modules/payment/provider-registry.ts`.

Ventas, pantallas y cierre de caja no cambian.

### Garantías del módulo de pagos

- Los montos se calculan en el servidor.
- Cada cobro lleva una clave de idempotencia, así que un doble clic o un reintento no duplica la venta.
- Si el proveedor no responde, el cobro queda `UNKNOWN` y se vuelve a consultar. Nunca se da por fallido sin saberlo.
- Un proceso en segundo plano revisa los cobros abiertos cada 30 segundos.
