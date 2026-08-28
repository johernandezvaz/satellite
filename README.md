# 🛰️ Satellite — Control Center & Process Manager

**Satellite** es un panel de control centralizado y gestor de procesos diseñado para administrar el ecosistema de aplicaciones (Next.js / Node.js) de **Safe Demo**. Permite iniciar, detener, reiniciar, actualizar vía Git y monitorear en tiempo real el estado, puertos, errores, uptime y bases de datos de cada servicio administrado.

---

## 📑 Tabla de Contenidos

1. [Arquitectura del Sistema](#-arquitectura-del-sistema)
2. [Guía de Diseño & Tokens Visuales (Light Theme)](#-guía-de-diseño--tokens-visuales)
3. [Base de Datos & Esquema](#-base-de-datos--esquema)
4. [Mecanismo de Detección de Bases de Datos](#-mecanismo-de-detección-de-bases-de-datos)
5. [Autenticación & Seguridad](#-autenticación--seguridad)
6. [API REST & Comunicación WebSocket](#-api-rest--comunicación-websocket)
7. [Ciclo de Vida de Procesos & Health Check](#-ciclo-de-vida-de-procesos--health-check)
8. [Dependencias & Stack Tecnológico](#-dependencias--stack-tecnológico)
9. [Instalación & Puesta en Marcha](#-instalación--puesta-en-marcha)
10. [Instrucciones para Agentes & Desarrolladores](#-instrucciones-para-agentes--desarrolladores)

---

## 🏛️ Arquitectura del Sistema

```text
                         ┌─────────────────────────────────┐
                         │          Satellite UI           │
                         │    http://localhost:4570        │
                         │   Vanilla HTML5 / CSS3 / JS     │
                         └───────────────┬─────────────────┘
                                         │
                             REST API / WebSocket (ws://)
                                         │
                         ┌───────────────▼─────────────────┐
                         │        Satellite Server         │
                         │       Node.js + Express         │
                         │ Process Manager + Tree-Kill     │
                         └───────┬─────────────────┬───────┘
                                 │                 │
                    ┌────────────┘                 └─────────────┐
                    │                                            │
          ┌─────────▼──────────┐                       ┌─────────▼──────────┐
          │  PostgreSQL        │                       │   Managed Apps     │
          │  Database:         │                       │                    │
          │  `satellite`       │                       │  Next.js Apps      │
          │                    │                       │  Ports: 4551–4561  │
          │  - apps            │                       │  Own .env & DBs    │
          │  - users           │                       │  (Postgres, SQLite)│
          └────────────────────┘                       └────────────────────┘
```

> **Persistencia:** PostgreSQL (`satellite`) es la única fuente de verdad para las aplicaciones registradas y los usuarios de Satellite. `apps.json` se mantiene únicamente como referencia histórica / backup opcional.

---

## 🎨 Guía de Diseño & Tokens Visuales

Satellite utiliza **Light Theme como tema principal**. Su estética está inspirada en un centro de control de infraestructura profesional, limpio y moderno.

### Paleta Principal

| Nombre | Hex | Uso |
|---|---|---|
| **Blue** | `#1D559A` | Color primario de marca, botones principales, links y foco |
| **Navy** | `#0E254E` | Encabezados, títulos, tipografía principal y badges oscuros |
| **Gray** | `#DFE1E7` | Bordes principales, divisores y líneas de separación |
| **Background** | `#F0F4FA` | Fondo general de la aplicación |
| **White** | `#FFFFFF` | Superficie de tarjetas, modales y header |
| **Slate** | `#64748B` | Textos secundarios, labels y metadata |
| **Light Blue** | `#4F8FD9` | Estados hover, highlights y acentos de carga |
| **Pale Blue** | `#DCEBFA` | Fondos de badges de puerto y botones secundarios |

### Colores Semánticos (Estados Operativos)

| Estado | Color | Hex | Aplicación |
|---|---|---|---|
| **Running / Success** | Green | `#22A06B` | Proceso activo y escuchando en su puerto |
| **Starting / Warning**| Amber | `#D99A24` | Proceso en arranque o verificación |
| **Error** | Red | `#D64545` | Salida anormal, fallos de compilación o excepciones |
| **Information** | Cyan | `#2F9BC1` | Logs de Git y notificaciones del sistema |

> ⚠️ **Regla visual crítica:** **Sin emojis en la interfaz de usuario.** Toda la iconografía se renderiza mediante vectores **SVG minimalistas**.

---

## 🗄️ Base de Datos & Esquema

La base de datos central de Satellite se denomina `satellite` en PostgreSQL.

### Tabla: `apps`

Almacena la metadata de cada aplicación registrada.

```sql
CREATE TABLE IF NOT EXISTS apps (
  id              TEXT PRIMARY KEY,                  -- Slug único (ej. "gestion-comedor")
  name            TEXT NOT NULL,                     -- Nombre legible (ej. "Gestión de Comedor")
  path            TEXT NOT NULL,                     -- Ruta absoluta local al proyecto
  port            INTEGER NOT NULL UNIQUE,           -- Puerto HTTP asignado
  package_manager TEXT NOT NULL DEFAULT 'npm',       -- "npm" | "pnpm"
  db_type         TEXT,                              -- Motor detectado (ej. "PostgreSQL", "SQLite")
  db_name         TEXT,                              -- Nombre de BD detectado (ej. "gestion_comedor")
  created_at      TIMESTAMPTZ DEFAULT NOW()          -- Fecha de registro
);
```

### Tabla: `users`

Almacena las credenciales de acceso administrativo al panel.

```sql
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,                -- Correo administrativo
  password_hash TEXT NOT NULL,                       -- Hash bcrypt (cost factor 12)
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🔍 Mecanismo de Detección de Bases de Datos

Satellite analiza automáticamente el entorno de cada aplicación registrada sin ejecutar su código ni comprometer secretos:

### Archivos Inspeccionados (en orden de precedencia)
1. `.env`
2. `.env.local`
3. `.env.production`
4. `.env.development`

### Variables de Conexión Reconocidas
`DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `DATABASE_URL_NON_POOLING`, `MYSQL_URL`, `MONGODB_URI`, `MONGO_URI`.

### Motores Soportados & Extracción de Nombre
- **PostgreSQL**: `postgresql://user:pass@host:5432/mi_db` $\rightarrow$ Tipo: `PostgreSQL`, Nombre: `mi_db`
- **SQLite**: `file:./prisma/dev.db` o `./data/database.db` $\rightarrow$ Tipo: `SQLite`, Nombre: `dev.db`
- **MySQL**: `mysql://user:pass@host:3306/tienda` $\rightarrow$ Tipo: `MySQL`, Nombre: `tienda`
- **MongoDB**: `mongodb://user:pass@host:27017/logs` $\rightarrow$ Tipo: `MongoDB`, Nombre: `logs`

> 🔒 **Seguridad estricta:** La interfaz **NUNCA** expone contraseñas, tokens ni cadenas de conexión completas. Solo muestra `db_type` y `db_name`.

---

## 🔐 Autenticación & Seguridad

- **Sesiones**: Gestionadas mediante `express-session` con cookies `httpOnly`.
- **Protección de Rutas**: Todas las rutas de `/api/apps/*` requieren sesión activa (`requireAuth`). Las peticiones no autorizadas retornan código `401 Unauthorized`.
- **Usuario Inicial de Administrador**:
  - Correo: `` (también soporta `.con`)
  - Contraseña por defecto: `` (hasheada con `bcrypt`)

---

## 📡 API REST & Comunicación WebSocket

### Endpoints de Autenticación
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/auth/me` | Retorna `{ authenticated: boolean, email?: string }` |
| `POST` | `/api/auth/login` | Recibe `{ email, password }`, inicia sesión |
| `POST` | `/api/auth/logout` | Destruye la sesión del usuario |

### Endpoints de Aplicaciones (Protegidos)
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/apps` | Lista todas las aplicaciones con su estado volátil de runtime |
| `POST` | `/api/apps` | Registra una nueva app `{ name, path, port, packageManager }` |
| `PUT` | `/api/apps/:id` | Edita metadata de una app detenida `{ name, path, port, packageManager }` |
| `DELETE` | `/api/apps/:id` | Elimina una app registrada del panel (no borra archivos en disco) |
| `POST` | `/api/apps/:id/start` | Inicia el proceso de la app |
| `POST` | `/api/apps/:id/stop` | Detiene el árbol de procesos mediante `tree-kill` |
| `POST` | `/api/apps/:id/restart` | Detiene, espera 2.5s y vuelve a iniciar la app |
| `POST` | `/api/apps/:id/update` | Ejecuta `git pull origin main` y re-detecta la base de datos |
| `POST` | `/api/apps/:id/refresh-db` | Fuerza la re-detección de la base de datos desde `.env` |
| `GET` | `/api/apps/:id/errors` | Obtiene el historial de los últimos 100 errores capturados |

### Eventos WebSocket (`ws://localhost:4570`)
- `init`: Envía la lista completa de aplicaciones y estados al conectar.
- `apps`: Notifica cambios en la lista de aplicaciones registradas.
- `status`: Notifica cambio de estado de una app (`running`, `starting`, `stopped`, `error`).
- `error`: Emite un nuevo error capturado en `stdout`/`stderr`.
- `update`: Emite el progreso y resultado de la actualización vía Git.
- `db_update`: Emite nueva metadata de base de datos detectada.

---

## ⚡ Ciclo de Vida de Procesos & Health Check

1. **Arranque (`startApp`)**:
   - Ejecuta `npm run serve` o `pnpm run serve` según el `packageManager`.
   - Estado transitorio: `starting`.
   - Escucha `stdout` para detectar cadenas listas (`Ready in`, `ready - started`).
   - Activa sondeo TCP recurrente (`startHealthPoll`) conectando al puerto de la app hasta confirmar respuesta.
2. **Monitoreo (`startPeriodicCheck`)**:
   - Una vez en estado `running`, realiza comprobaciones TCP periódicas cada 15 segundos.
3. **Parada (`stopApp`)**:
   - Utiliza `tree-kill` para terminar todo el árbol de procesos secundarios en Windows (`SIGTERM` / `SIGKILL`).
   - Estado: `stopped`.

---

## 📦 Dependencias & Stack Tecnológico

- **Backend**: Node.js, Express 4, `ws` (WebSockets), `pg` (PostgreSQL client), `bcrypt` (hashing), `express-session`, `tree-kill`, `dotenv`.
- **Frontend**: HTML5 Semántico, CSS3 Puro (Variables CSS, Flexbox, Grid), JavaScript Vanilla (ES6+ Asíncrono).
- **Tipografía**: `Inter` (Google Fonts).

---

## 🚀 Instalación & Puesta en Marcha

### 1. Requisitos Previos
- Node.js (v18 o superior)
- PostgreSQL corriendo localmente
- `pnpm` o `npm`

### 2. Configuración de Variables de Entorno (`.env`)
Crear un archivo `.env` en la raíz del proyecto:

```env
DATABASE_URL=postgresql://postgres:TU_PASSWORD@localhost:5432/satellite
SESSION_SECRET=genera_una_clave_secreta_aleatoria_aqui
```

### 3. Instalación de Dependencias
```bash
pnpm install
```

### 4. Iniciar Satellite
```bash
pnpm run serve
```
Acceder al panel en:
- Local: [http://localhost:4570](http://localhost:4570)
- Red Local: [http://[IP_ADDRESS]](http://[IP_ADDRESS])

---

## 🤖 Instrucciones para Agentes & Desarrolladores

Al modificar o extender Satellite, seguir estas pautas obligatorias:

1. **Consistencia de Diseño**: Mantener el **Light Theme** estricto utilizando las variables CSS de `:root`. Nunca reintroducir colores oscuros como fondo general ni utilizar emojis en el DOM.
2. **Seguridad en Detección**: Cualquier extensión al módulo de detección de base de datos (`detectDatabase`) debe sanitizar las salidas para no exponer credenciales bajo ninguna circunstancia.
3. **Procesos en Windows**: Al interactuar con procesos del sistema operativo, utilizar siempre `tree-kill` para evitar procesos huérfanos en segundo plano.
4. **Validación de Puertos y Slugs**: Al agregar o editar apps, validar unicidad de `port` y `id` antes de persistir en PostgreSQL.
