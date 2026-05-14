# Guía de Implementación Paso a Paso

Esta guía te ayudará a configurar Trench Predator V1.1 desde cero.

## Requisitos Previos

- **Node.js 20+** instalado.
- **n8n** (instancia auto-alojada recomendada para usar Redis/Postgres).
- **Redis** y **PostgreSQL**.
- Claves de API para:
  - RugCheck (opcional, pero recomendado).
  - GoPlus.
  - SolSniffer.
  - RPC de Solana (Helius, QuickNode, etc).

---

## Paso 1: Configuración de la Base de Datos

Ejecuta el esquema proporcionado en tu instancia de PostgreSQL:

```bash
psql -h localhost -U tu_usuario -d tu_base_de_datos -f database/schema.sql
```

Esto creará las tablas necesarias para señales, posiciones, logs de decisión y el ciclo de aprendizaje.

## Paso 2: Variables de Entorno

Crea un archivo `.env` en tu servidor n8n con los siguientes valores:

```env
# Solana
SOLANA_WALLET_PUBLIC_KEY=tu_clave_publica
SOL_USD=150
JUPITER_SLIPPAGE_BPS=1500
JUPITER_EXIT_SLIPPAGE_BPS=2000
JUPITER_MAX_PRIORITY_LAMPORTS=10000000

# Servicio firmador seguro
SIGNER_URL=http://127.0.0.1:8787/sign-and-send
SIGNER_API_KEY=tu_signer_api_key

# APIs de Seguridad
RUGCHECK_API_KEY=tu_api_key
GOPLUS_API_KEY=tu_api_key
SOLSNIFFER_API_KEY=tu_api_key

# Database
DATABASE_URL=postgres://user:password@localhost:5432/trench
REDIS_URL=redis://localhost:6379
```

## Paso 3: Importar Workflow en n8n

1. Abre n8n.
2. Crea un nuevo flujo (Workflow).
3. Ve al menú de la esquina superior derecha e importa el archivo:
   `n8n/workflows/trench-predator-v1.1.workflow.json`.
4. Configura las credenciales de PostgreSQL y Redis en los nodos correspondientes si no usas las credenciales locales de desarrollo importadas.

## Paso 4: Configuración de Nodos de Código

Los fragmentos de lógica están en `n8n/code-nodes/` y se embeben en el workflow exportado. El workflow usa nodos nativos de Redis, PostgreSQL y HTTP para estado, persistencia y llamadas externas. Si editas un fragmento, regenera el workflow importable:

```bash
npm run sync:workflow
```

## Paso 5: Prueba en "Paper Mode" (Modo Simulado)

Antes de activar el nodo de swap real (`05-jupiter-buy.js`):
1. Asegúrate de que el flujo de Telegram/Webhook esté recibiendo mensajes.
2. Verifica en PostgreSQL que se estén insertando entradas en la tabla `signals`.
3. Revisa la tabla `decision_logs` para ver por qué se aprueban o rechazan los tokens.

## Paso 6: Activación del Firmador (Signer)

El bot genera la transacción (`serializedTransaction`), pero **no la firma automáticamente** por seguridad.
1. Implementa un servicio firmador privado en `SIGNER_URL` que tome ese campo, lo firme con tu clave privada y lo envíe a la red.
2. Una vez confirmado el envío, actualiza el estado de la posición en la tabla `positions`.

---

## Mantenimiento

- **Ciclo de Aprendizaje**: La tabla `learning_patterns` se llenará automáticamente. Pasadas unas 100 operaciones, el bot empezará a filtrar basado en el rendimiento histórico de patrones similares.
- **Circuit Breaker**: Si el bot deja de operar, revisa la clave `trench:circuit_breaker` en Redis para ver el motivo del paro de seguridad.
