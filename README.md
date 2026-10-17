# Kiosco Domingo — Sistema POS para kioscos 🛒

Sistema de punto de venta para kioscos y comercios minoristas: cobro por código de barras, control de
stock, varios locales con sus cajeros, cobros con QR y transferencia, tickets en impresora térmica y
estadísticas de facturación.

Se puede usar de dos formas:

- **Programa de escritorio (.exe)** para una sola PC, sin internet ni Docker, activado con licencia por equipo.
- **Servidor con Docker** para usar desde varias cajas de la misma red con el navegador.

## 🚀 Funcionalidades

- **Venta por código de barras** con carrito, cantidades y total calculado en el servidor.
- **Productos y stock**: alta de productos, precio y costo, stock mínimo y aviso de stock bajo.
- **Medios de pago**: efectivo, tarjeta, mixto, QR y transferencia a alias (ver [Medios de pago](#-medios-de-pago)).
- **Varios locales**: cada local tiene sus productos, ventas, cajeros y alias. Los datos de un local no se ven desde otro.
- **Usuarios con perfiles**: administrador y cajero, con inicio de sesión por token (JWT).
- **Cierre de caja diario** por local, contando solo las ventas cobradas.
- **Estadísticas** para el administrador: facturación, ganancia, margen, ticket promedio, horarios y productos más vendidos.
- **Tickets ESC/POS** en impresoras térmicas por red (TCP) o USB/COM (serial).
- **Anulación de ventas** con devolución del stock.

## 🛠️ Tecnologías

| Parte | Tecnología |
|-------|------------|
| Servidor | Node.js 20, Express, TypeScript |
| Base de datos | SQLite con Prisma (migraciones en `prisma/migrations`) |
| Validación | Zod |
| Autenticación | JWT (`jsonwebtoken`) y contraseñas con scrypt |
| Frontend | HTML + JavaScript sin framework (`public/index.html`), servido por el mismo servidor |
| Escritorio | Electron + electron-builder (instalador NSIS para Windows) |
| Licencias | Firmas Ed25519 (`crypto` de Node) |
| Despliegue | Docker y Docker Compose |
| Impresión | ESC/POS por TCP o `serialport` |

## 📁 Estructura del proyecto

```
src/
  index.ts                 Arranque del servidor (también lo usa Electron)
  db.ts / migrate.ts       Cliente Prisma y migraciones al iniciar el programa de escritorio
  api/                     Rutas HTTP: auth, setup, admin, pagos, productos y ventas
  modules/
    auth/                  Login, tokens, contraseñas y creación del administrador inicial
    sale/                  Ventas, stock y cierre de caja
    payment/               Cobros y proveedores de pago (QR, alias, inmediato)
    stats/                 Estadísticas de facturación
    print/                 Impresión de tickets ESC/POS
prisma/                    Esquema y migraciones de la base
public/                    Frontend
electron/                  Programa de escritorio, pantalla de activación y licencias
instalador/                Instalador con Docker para entregar a un cliente (instalar.bat, LEEME.txt)
scripts/                   Generador de licencias y armado del paquete de instalación
```

## ⚙️ Desarrollo local

Requiere Node.js 20.

1. Cloná el repositorio e instalá las dependencias (también se genera el cliente Prisma):
   ```bash
   git clone https://github.com/tomy91449/facturacion-kiosco.git
   cd facturacion-kiosco
   npm install
   ```
2. Copiá `.env.example` como `.env` y completá los valores. `JWT_SECRET` es obligatorio; podés generarlo con:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
3. Creá la base y arrancá:
   ```bash
   npx prisma migrate deploy
   npm run dev          # servidor con recarga en http://127.0.0.1:4000
   npm run electron     # o el programa de escritorio (en desarrollo no pide licencia)
   ```

| Script | Qué hace |
|--------|----------|
| `npm run dev` | Servidor con recarga automática |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm run electron` | Compila y abre el programa de escritorio |
| `npm run dist` | Arma el instalador `.exe` en `release/` |
| `npm run db:migrate` | Crea una migración nueva al cambiar `prisma/schema.prisma` |
| `npm run db:studio` | Abre Prisma Studio para ver la base |
| `npm run licencia` | Genera claves y licencias (ver abajo) |

### Variables de entorno

Están todas en `.env.example`. Las principales:

| Variable | Uso |
|----------|-----|
| `JWT_SECRET` | Clave para firmar las sesiones (mínimo 32 caracteres). **Obligatoria.** |
| `JWT_EXPIRES_IN` | Duración de la sesión, por ejemplo `12h` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Administrador inicial; se crea solo si la base no tiene usuarios |
| `HOST` / `PORT` | Interfaz y puerto. `127.0.0.1` = solo esta PC; en Docker se usa `0.0.0.0` |
| `DATABASE_URL` | Ruta de la base SQLite |
| `PRINTER_TYPE` | `tcp` (red) o `serial` (USB/COM), con `PRINTER_HOST`/`PRINTER_PORT` o `PRINTER_PATH`/`PRINTER_BAUD` |
| `PAPER_WIDTH` | Caracteres por línea: 48 para papel de 80 mm, 32 para 58 mm |
| `STORE_*`, `TICKET_FOOTER` | Datos del comercio que salen en el ticket |
| `QR_PROVIDER` | Vacío = QR deshabilitado; `simulator` = QR de prueba |

> El `.env` nunca se sube al repositorio (está en `.gitignore`).

## 💻 Programa de escritorio (.exe) con licencia por PC

Instalador de Windows que corre todo dentro de la PC del cliente: el servidor solo escucha en
`127.0.0.1` y se muestra en una ventana. No necesita Docker ni internet.

**Armar el instalador:**
```bash
npm run dist
```
Queda en `release/Kiosco Domingo Setup <versión>.exe`. Para una versión nueva, subí `version` en `package.json`.

**Licencias** (la primera vez: `npm run licencia -- crear-claves`):
1. El cliente instala y abre el programa: le aparece un código del equipo (`KD-XXXX-XXXX-XXXX`).
2. Generás su clave: `npm run licencia -- KD-XXXX-XXXX-XXXX "Nombre del cliente"`.
3. El cliente la pega y queda activado para siempre en esa PC.

La clave privada vive en `%USERPROFILE%\KioscoDomingo-licencias`, fuera del repositorio, junto a
`registro.csv` con las licencias emitidas. El programa solo lleva la clave pública
(`electron/clave-publica.pem`). **Guardá una copia de la clave privada fuera de la PC**: si se pierde,
los instaladores ya entregados no se pueden activar en equipos nuevos.

**Datos del cliente:** `%APPDATA%\Kiosco Domingo\datos`

| Archivo | Contenido |
|---------|-----------|
| `pos.db` | Base de datos |
| `respaldos\` | Copia diaria automática de la base, de los últimos 30 días |
| `configuracion.env` | Impresora y datos del ticket |
| `registro.log` | Errores |

Desinstalar o actualizar el programa no borra estos datos. Las migraciones nuevas se aplican solas al
abrir el programa. La primera vez, el administrador se crea desde la pantalla (solo desde la misma PC).

> Sin certificado de firma de código, Windows muestra "Windows protegió su PC" al instalar:
> "Más información" → "Ejecutar de todas formas".

## 🐳 Servidor con Docker

1. Creá el `.env` a partir de `.env.example` con `JWT_SECRET`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`.
2. Levantá el contenedor:
   ```bash
   docker compose up -d --build
   ```
3. Entrá desde cualquier PC de la red a `http://<ip-del-servidor>:4000` con el usuario administrador.
4. En **Administración**, creá un local por cada sucursal y un usuario cajero para cada uno.

La base queda en el volumen `kiosco-data`, así que sobrevive a las actualizaciones: al arrancar, el
contenedor aplica las migraciones pendientes. La imagen corre sin root, con zona horaria de Argentina
y con un healthcheck.

Dentro de Docker, la impresora tiene que ser de red (`PRINTER_TYPE=tcp`).

> Si el servidor va a ser accesible desde Internet, ponelo detrás de un proxy con HTTPS
> (por ejemplo Caddy o Nginx): sin HTTPS, usuario, contraseña y token viajan en texto plano.

### Instalador con Docker para un cliente

Para dejarlo instalado en la PC de un cliente sin pasarle el código:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\crear-paquete.ps1
```

Genera `kiosco-domingo-instalador.zip` con la imagen exportada y los archivos de `instalador/`.
El cliente lo descomprime y ejecuta `instalar.bat`, que completa el `.env`, carga la imagen y abre el
sistema; `respaldar.bat` copia la base a `respaldos\`. Los pasos para el cliente están en
`instalador/LEEME.txt`.

## 👥 Usuarios y locales

| Rol | Qué puede hacer |
|-----|-----------------|
| **Administrador** | Crear, habilitar y deshabilitar locales; crear y editar usuarios (nombre, perfil, local y contraseña); confirmar transferencias; ver las estadísticas de todos los locales u operar en uno eligiéndolo arriba a la derecha. |
| **Cajero** | Vender, cargar productos y ver el cierre de caja **solo de su local**. |

Deshabilitar un local corta al instante el acceso de sus cajeros; sus ventas se conservan. Siempre queda
al menos un administrador activo, y nadie puede quitarse a sí mismo el perfil de administrador.

## 📊 Estadísticas

Pestaña del administrador. Para el período elegido muestra:

- Facturación, ganancia bruta y margen, comparados con el período anterior.
- Cantidad de tickets, ticket promedio y ventas anuladas.
- Facturación por día, por hora, por medio de pago y por local.
- Los 10 productos que más facturan y los productos con stock bajo.

La ganancia usa el costo guardado en cada venta (`sale_items.unit_cost`), así un cambio de costo no
altera las ventas pasadas. Las ventas anteriores a ese dato usan el costo actual del producto.

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

Se elige con `QR_PROVIDER`:

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

## 🔌 API

Todas las rutas exigen el header `Authorization: Bearer <token>`, salvo `POST /auth/login` y `/setup`
(creación del primer administrador, solo desde la misma PC). Las respuestas tienen la forma
`{ success, data }` o `{ success: false, error }`.

| Área | Rutas |
|------|-------|
| Sesión | `POST /auth/login`, `GET /auth/me` |
| Primer uso | `GET /setup/status`, `POST /setup` |
| Productos | `GET /products`, `POST /products`, `GET /products/barcode/:code`, `GET /products/low-stock`, `PATCH /products/:id/price` |
| Ventas | `POST /sales`, `GET /sales`, `GET /sales/daily-summary?date=AAAA-MM-DD`, `POST /sales/:id/cancel` |
| Pagos | `GET /payments/methods`, `GET /payments/open`, `GET /payments/:id`, `POST /payments/:id/cancel`, `POST /payments/:id/confirm`, `POST /payments/:id/simulate` |
| Administración | `GET/POST /stores`, `PATCH /stores/:id`, `GET/POST /users`, `PATCH /users/:id` |
| Estadísticas | `GET /stats?from=AAAA-MM-DD&to=AAAA-MM-DD` |

El administrador elige el local con `storeId` (en la query o el body); sin él, ve todos los locales. El cajero siempre queda limitado al suyo.
