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

## 👥 Usuarios y locales

| Rol | Qué puede hacer |
|-----|-----------------|
| **Administrador** | Crear locales y usuarios, ver la facturación de todos los locales u operar en uno eligiéndolo arriba a la derecha. |
| **Cajero** | Vender, cargar productos y ver el cierre de caja **solo de su local**. |

Toda la API exige el header `Authorization: Bearer <token>`, que se obtiene en `POST /auth/login`.
