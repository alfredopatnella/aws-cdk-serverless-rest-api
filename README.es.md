# API REST Serverless con AWS CDK

🌐 Idioma: [English](README.md) | **Español**

Una arquitectura de referencia deliberadamente pequeña que demuestra cómo
construir, desplegar, asegurar, probar y operar una API REST serverless
usando API Gateway, AWS Lambda, DynamoDB, TypeScript y AWS CDK.

## Descripción general

Este repositorio implementa una pequeña **API de Tareas** — `POST /items`,
`GET /items`, `GET /items/{id}`, `DELETE /items/{id}` — usando únicamente
servicios administrados de AWS e infraestructura como código
(Infrastructure as Code). Está pensado para:

* Desarrolladores de software que están aprendiendo AWS
* Desarrolladores que están aprendiendo AWS CDK
* Ingenieros cloud
* Arquitectos cloud junior e intermedios
* Managers de ingeniería que quieren entender la arquitectura
* Desarrolladores que están migrando de aplicaciones REST tradicionales
  (Express, Django, Rails, Spring, ...) hacia arquitecturas serverless en
  AWS

El proyecto evita deliberadamente abstracciones complejas: sin framework
web, sin ORM, sin contenedor de inyección de dependencias, sin pipeline
multi-entorno. El objetivo es que cualquiera pueda leer todos los archivos
de `lib/` y `src/` en una sola sesión y entender exactamente qué
construye AWS y por qué, sin que las convenciones de un framework se
interpongan entre la persona lectora y los servicios de AWS subyacentes.
Cada decisión de diseño a continuación intercambia algo de sofisticación
de producción por claridad didáctica; la sección [Consideraciones para
producción](#consideraciones-para-producción) es explícita sobre dónde se
trazó esa línea.

## Arquitectura

```text
                  ┌──────────────────────┐
                  │       Cliente        │
                  └──────────┬───────────┘
                             │ HTTPS
                             ▼
                  ┌──────────────────────┐
                  │    API Gateway       │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │     AWS Lambda       │
                  │ Handlers TypeScript  │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │      DynamoDB        │
                  │ Partition key: id    │
                  └──────────────────────┘

        Servicios de soporte usados en todo el stack:
        IAM (permisos por función), CloudWatch (logs),
        CDK / CloudFormation (define y despliega todo lo anterior)
```

* **API Gateway** es el único punto de entrada público. Termina HTTPS,
  hace coincidir la ruta/método de la solicitud, opcionalmente valida el
  cuerpo de la solicitud, e invoca la función Lambda correspondiente.
* **Lambda** ejecuta la lógica de la aplicación: una pequeña función
  TypeScript por operación. Sin servidores que parchear, aprovisionar o
  escalar manualmente.
* **DynamoDB** es el almacén persistente: una única tabla con clave `id`.
* **IAM** otorga a cada función Lambda únicamente la acción de DynamoDB
  que realiza.
* **CloudWatch** recibe los logs de cada invocación de Lambda y de los
  logs de acceso de API Gateway.
* **CDK** define todo lo anterior como TypeScript y lo convierte en una
  plantilla de CloudFormation que AWS efectivamente despliega.

Consulta [docs/es/architecture.md](docs/es/architecture.md) para un
recorrido más profundo, incluyendo un diagrama de secuencia para cada
ruta.

## ¿Qué problema resuelve esta arquitectura?

Este patrón es una opción habitual para APIs HTTP pequeñas o medianas
porque resuelve varios problemas a la vez, usando principalmente
servicios administrados:

* **Exponer una API HTTPS** — API Gateway ofrece terminación TLS, una URL
  estable y enrutamiento de solicitudes sin necesidad de operar un
  balanceador de carga o un servidor web.
* **Ejecutar lógica de aplicación sin administrar servidores** — Lambda
  ejecuta tu código bajo demanda; no hay una instancia EC2 ni un
  contenedor que parchear, monitorear por CPU/memoria, o mantener
  "caliente".
* **Persistir el estado de la aplicación** — DynamoDB almacena datos de
  forma duradera entre solicitudes e invocaciones de Lambda (Lambda en sí
  no tiene estado local persistente).
* **Escalar automáticamente** — API Gateway, Lambda y DynamoDB (en modo
  on-demand) escalan con el tráfico sin planificación manual de
  capacidad.
* **Pagar principalmente por uso** — los tres servicios principales
  facturan según solicitudes/invocaciones/capacidad consumida, en lugar
  de capacidad reservada y siempre activa. Ver [Costos](#costos).
* **Desplegar infraestructura de forma repetible** — toda la arquitectura
  está definida en código (CDK) y puede crearse, actualizarse o destruirse
  de forma determinista, en lugar de armarse a mano en la consola.

## Ciclo de vida de una solicitud

### POST /items

```text
1. El cliente envía una solicitud HTTPS con un cuerpo JSON: { "title": "..." }.
2. API Gateway recibe la solicitud.
3. API Gateway hace coincidir POST /items y valida el cuerpo contra un modelo JSON Schema.
4. API Gateway invoca la función Lambda create-item.
5. Lambda vuelve a validar el cuerpo de la solicitud (defensa en profundidad).
6. Lambda genera un UUID, un timestamp createdAt y completed=false.
7. Lambda llama a DynamoDB PutItem para almacenar la tarea.
8. DynamoDB confirma la escritura.
9. Lambda construye una respuesta HTTP 201 Created con el nuevo item como JSON.
10. API Gateway devuelve esa respuesta al cliente.
```

### GET /items y GET /items/{id}

`GET /items` sigue la misma forma, pero la función Lambda `list-items`
llama a DynamoDB `Scan` y devuelve todos los items como un array JSON con
`200 OK`.

`GET /items/{id}` llama a DynamoDB `GetItem` con el parámetro de ruta
`id`. Si el item existe, la Lambda devuelve `200 OK` con el item; si no,
devuelve `404 Not Found` con un cuerpo de error estructurado — DynamoDB
simplemente reporta "no hay item", y es la Lambda quien convierte eso en
un código de estado HTTP.

### DELETE /items/{id}

La función Lambda `delete-item` llama a DynamoDB `DeleteItem` con una
expresión de condición que exige que el item ya exista. Si existía, la
Lambda devuelve `204 No Content`. Si no existía, DynamoDB reporta un
fallo de verificación condicional (conditional check failure), que la
Lambda traduce a `404 Not Found` en lugar de reportar silenciosamente
éxito para un borrado que no hizo nada (no-op).

## Recursos de AWS creados

| Recurso                                | Propósito                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| API REST de API Gateway                  | Punto de entrada HTTPS público; enruta solicitudes a Lambda        |
| 4 funciones Lambda                       | Lógica de aplicación para crear/listar/obtener/eliminar            |
| Tabla de DynamoDB                        | Almacenamiento persistente para los items de tareas, con clave `id` |
| 4 roles de ejecución IAM + políticas     | Uno por Lambda, cada uno limitado a una única acción de DynamoDB   |
| 5 grupos de logs de CloudWatch           | Uno por función Lambda, más uno para los logs de acceso de API Gateway |

CDK/CloudFormation también aprovisiona automáticamente recursos de
soporte — por ejemplo, un deployment y un stage de API Gateway, y un
recurso de permiso de Lambda por ruta que otorga a API Gateway el
derecho de invocar cada función. Estos no se escriben a mano; CDK los
genera como consecuencia de los constructs anteriores.

## Modelo de datos de DynamoDB

Cada item se almacena así:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "title": "Prepare architecture documentation",
  "completed": false,
  "createdAt": "2026-08-13T12:00:00.000Z"
}
```

**Partition key: `id` (string).** La partition key (clave de partición)
de DynamoDB es el atributo que DynamoDB aplica a una función hash para
decidir en qué partición de almacenamiento interna se guarda físicamente
un item. Cada lectura o escritura debe suministrar esta clave
(directamente, o mediante una consulta sobre ella) — DynamoDB no tiene el
concepto de recorrer una sola partición "por número de fila" como sí lo
haría una tabla relacional.

`id` funciona bien aquí porque todo acceso a un item *específico* — un
`GetItem` o `DeleteItem` — ocurre mediante un identificador opaco que el
cliente recibió cuando el item fue creado. No hay necesidad de buscar
items por título, fecha, ni por ningún otro atributo en este ejemplo, así
que una única partition key de tipo string es suficiente; no se necesitan
índices secundarios.

Esto es precisamente lo que hace que `GET /items/{id}` y
`DELETE /items/{id}` sean operaciones baratas y de tiempo constante:
DynamoDB enruta la solicitud directamente a la partición que contiene esa
clave con `GetItem`/`DeleteItem`, en lugar de inspeccionar cada item de la
tabla.

Listar *todos* los items (`GET /items`), en cambio, no tiene una clave
por la cual buscar — "dame todo" no es una consulta por partition key.
Este ejemplo usa un `Scan` de DynamoDB, que lee cada item de la tabla.
Eso es simple y correcto a la escala para la que este proyecto está
pensado (una tabla de demostración personal con un puñado de items), pero
tanto el costo como la latencia de `Scan` crecen con el tamaño total de la
tabla, no con la cantidad de items que realmente quieres recuperar. Una
carga de trabajo de producción con una tabla grande o en crecimiento
reemplazaría esto por una `Query` contra una clave/índice bien elegido (si
existe una forma natural de particionar las solicitudes de "listado",
como por propietario) o por un escaneo paginado y limitado en tasa — ver
[Consideraciones para producción](#consideraciones-para-producción).

## Manejo de errores

Cada respuesta —éxito o fallo— es JSON con un encabezado
`Content-Type: application/json`. Los errores siempre siguen la misma
forma:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title is required"
  }
}
```

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Item was not found"
  }
}
```

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

* **Errores de validación** (`400`) ocurren cuando el cuerpo de la
  solicitud falla la validación — un `title` ausente, en blanco, o que no
  es un string; un JSON malformado, o un cuerpo ausente.
* **Errores de "no encontrado"** (`404`) ocurren cuando `GET`/`DELETE`
  apuntan a un `id` que no existe en la tabla.
* **Errores inesperados** (`500`) ocurren cuando algo falla que no
  corresponde a un caso de validación o de "no encontrado" — por ejemplo,
  un error del servicio DynamoDB. El cliente solo ve el mensaje genérico
  de arriba; la excepción real se registra en CloudWatch (ver
  [Seguridad](#seguridad)) para poder diagnosticarla sin exponer detalles
  internos a quien llama.

## Seguridad

* **Mínimo privilegio (least privilege)** — el rol IAM de cada Lambda
  otorga exactamente una acción de DynamoDB, limitada a esta única tabla.
  Ninguna función puede llamar a `dynamodb:*`, y ninguna puede tocar una
  tabla distinta a la suya.
* **HTTPS en todas partes** — API Gateway solo sirve tráfico HTTPS.
* **Roles de ejecución IAM** — cada Lambda se ejecuta bajo su propio rol;
  no existe un rol compartido de "hacer de todo".
* **Validación de entrada** — se aplica tanto en API Gateway (un modelo
  de solicitud con JSON Schema) como dentro de la propia Lambda.
* **Sin secretos en el código fuente** — el proyecto no tiene
  credenciales que gestionar; Lambda se autentica ante DynamoDB usando su
  rol de ejecución IAM.
* **Sin divulgación de excepciones internas** — los clientes reciben un
  mensaje genérico `INTERNAL_ERROR`; los detalles van solo a CloudWatch.

**La autenticación se omite intencionalmente en este demo.** Cualquier
ruta puede ser invocada públicamente por cualquiera que tenga la URL de
la API. Un despliegue de producción agregaría uno de los siguientes:
**Amazon Cognito**, un **autorizador JWT (JWT authorizer)**,
**autorización IAM**, o un **autorizador Lambda personalizado (custom
Lambda authorizer)** delante de las rutas existentes. Consulta
[docs/es/security.md](docs/es/security.md) para el modelo de seguridad
completo, la matriz de permisos IAM por función, y una discusión más
extensa de las opciones de autenticación para producción.

## Costos

Esta arquitectura es en general económica a bajo tráfico porque API
Gateway, Lambda y DynamoDB (en modo on-demand) facturan principalmente
por **uso**, en lugar de capacidad reservada y siempre activa:

* **API Gateway** — se factura por millón de solicitudes a la API, más
  transferencia de datos.
* **Lambda** — se factura por invocación y por duración de ejecución ×
  memoria asignada.
* **DynamoDB** — se factura por unidad de solicitud de lectura/escritura
  consumida (modo on-demand), más almacenamiento.
* **CloudWatch** — se factura por ingesta de logs, almacenamiento de
  logs, y métricas.

Este proyecto **no** fija montos en dólares específicos, ya que el
pricing de AWS varía por región y cambia con el tiempo. Consulta
[docs/es/cost-considerations.md](docs/es/cost-considerations.md) para una
explicación más completa de cada dimensión de facturación y un escenario
ilustrativo de bajo volumen. Usa la
[Calculadora de precios de AWS](https://calculator.aws/) para una
estimación basada en tu tráfico esperado real antes de confiar en
cualquier número.

## Despliegue

```bash
npm install
npm run build
npm test
npx cdk synth
npx cdk deploy
```

Si esta es la primera vez que despliegas una aplicación CDK en esta
cuenta/región de AWS, primero hazle bootstrap (un paso único por
cuenta/región):

```bash
npx cdk bootstrap
```

`cdk deploy` imprime los outputs del stack cuando termina, incluyendo:

```text
Outputs:
ServerlessRestApiStack.ApiUrl = https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/
```

Guarda ese valor como `API_URL` para los ejemplos siguientes:

```bash
export API_URL="https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod"
```

## Probando la API

```bash
# Crear un item
curl -X POST "$API_URL/items" \
  -H "Content-Type: application/json" \
  -d '{"title":"Learn AWS CDK"}'
# -> 201 Created
# { "id": "...", "title": "Learn AWS CDK", "completed": false, "createdAt": "..." }
```

```bash
# Listar todos los items
curl "$API_URL/items"
# -> 200 OK
# [ { "id": "...", "title": "Learn AWS CDK", ... } ]
```

```bash
# Obtener un item (reemplaza <id> con un id devuelto arriba)
curl "$API_URL/items/<id>"
# -> 200 OK, el JSON del item
# o 404 Not Found si el id no existe:
# { "error": { "code": "NOT_FOUND", "message": "Item was not found" } }
```

```bash
# Eliminar un item
curl -i -X DELETE "$API_URL/items/<id>"
# -> 204 No Content si tuvo éxito
# -> 404 Not Found si el id no existe
```

## Eliminación de recursos (destroy)

```bash
npx cdk destroy
```

Esto elimina cada recurso que CDK creó para este stack — la API de API
Gateway, las cuatro funciones Lambda, sus roles/políticas IAM, los grupos
de logs de CloudWatch y **la propia tabla de DynamoDB, incluyendo sus
datos**.

La tabla está configurada con `RemovalPolicy.DESTROY` específicamente
para que este proyecto pueda limpiarse por completo con un solo comando y
no deje nada atrás. Las bases de datos de producción casi nunca usan
`DESTROY` — típicamente usan `RemovalPolicy.RETAIN` (para que la tabla
sobreviva incluso si el stack se elimina) combinado con backups y/o
recuperación a un punto en el tiempo (point-in-time recovery), de modo
que eliminar infraestructura nunca pueda borrar datos accidentalmente.

## ¿Qué ocurre cuando algo falla?

| Escenario                            | Dónde se captura                            | Qué ve el cliente |
| -------------------------------------- | -------------------------------------------- | ----------------------- |
| Cuerpo JSON inválido                   | Validación de modelo en API Gateway, luego Lambda | `400 VALIDATION_ERROR` |
| `title` ausente o en blanco            | Validación de modelo en API Gateway, luego Lambda | `400 VALIDATION_ERROR` |
| Item inexistente (`GET`/`DELETE`)      | Lambda, tras consultar DynamoDB              | `404 NOT_FOUND` |
| Fallo del servicio DynamoDB            | Bloque `catch` de Lambda                     | `500 INTERNAL_ERROR` (detalles en CloudWatch) |
| Excepción no manejada en Lambda        | Bloque `catch` de Lambda                     | `500 INTERNAL_ERROR` (detalles en CloudWatch) |
| Permisos IAM insuficientes             | El SDK de DynamoDB lanza `AccessDeniedException`, capturada como cualquier otro error del SDK | `500 INTERNAL_ERROR` (la `AccessDeniedException` es visible en CloudWatch) |

En todos los casos de fallo, el cliente recibe una de las tres formas de
error estructuradas de [Manejo de errores](#manejo-de-errores) — nunca un
error crudo del SDK de AWS ni un stack trace. El detalle completo siempre
llega primero a CloudWatch, por lo que CloudWatch es el punto de partida
para diagnosticar cualquier fallo — ver
[docs/es/troubleshooting.md](docs/es/troubleshooting.md).

## Consideraciones para producción

Este proyecto es una referencia didáctica, no una plantilla de
producción. Llevar esta arquitectura hacia producción típicamente
implicaría agregar:

* **Autenticación y autorización** (Cognito, autorizadores JWT/IAM/personalizados —
  ver [Seguridad](#seguridad))
* **Un dominio personalizado** en lugar de la URL predeterminada de
  `execute-api`
* **AWS WAF** delante de la API
* **Throttling y cuotas de uso de la API** por cliente
* **Paginación** para `GET /items` en lugar de devolver toda la tabla
* **Evitar el `Scan` sin restricciones de DynamoDB** a medida que la
  tabla crece
* **Observabilidad**: IDs de correlación, métricas personalizadas y
  dashboards
* **Alarmas de CloudWatch** para tasas de error, throttling y latencia
* **Trazabilidad distribuida** (AWS X-Ray) a través de API Gateway →
  Lambda → DynamoDB
* **Validación de esquema más estricta** (por ejemplo, validación guiada
  por OpenAPI)
* **Manejo de idempotencia** para solicitudes `POST` reintentadas
* **Rate limiting** más allá de lo que ofrecen los usage plans de API
  Gateway
* **CI/CD** para compilar, probar y desplegar en cada cambio
* **Múltiples entornos** (dev/staging/prod) con stacks separados
* **Backups / recuperación a un punto en el tiempo** para DynamoDB
* **Una política de eliminación más conservadora** (`RETAIN` en lugar de
  `DESTROY`)
* **Versionado de la API** a medida que el contrato evoluciona
* **Métricas estructuradas** más allá de los logs (por ejemplo, embedded
  metric format)
* **Gestión de secretos** para cualquier credencial que la aplicación
  necesite

El objetivo de esta lista no es que cada punto sea difícil — la mayoría
son unas pocas líneas de CDK. El objetivo es hacer explícita la
*brecha* entre una arquitectura de referencia educativa y una de
producción, en lugar de dar a entender que este repositorio está listo
para producción tal como está.

## Alternativas arquitectónicas consideradas

**API Gateway REST API vs. HTTP API.** Este proyecto usa una REST API
porque permite que el ejemplo demuestre modelos de validación de
solicitudes y el registro de logs de acceso de CloudWatch directamente
en CDK — material didáctico útil. Las HTTP APIs son en general más
simples y más económicas por solicitud cuando esas características
específicas de REST API no son necesarias; son una opción por defecto
razonable para una nueva API que no las requiere.

**Lambda vs. contenedores.** Lambda encaja bien con esta carga de
trabajo: handlers de solicitud/respuesta cortos, sin estado (stateless)
y de tráfico irregular (bursty), sin procesos de larga duración.
ECS/Fargate o App Runner tendrían más sentido para procesos de larga
duración, cargas de trabajo que necesitan un runtime personalizado o
dependencias grandes, tráfico alto y constante de forma sostenida (donde
el cómputo siempre activo puede ser más económico que la facturación por
invocación), o aplicaciones que necesitan más control sobre el entorno de
ejecución del que Lambda ofrece.

**DynamoDB vs. una base de datos relacional.** DynamoDB encaja con un
patrón de acceso de "leer/escribir un item por una clave opaca, más
listar todo", sin joins ni transacciones multi-tabla. Una base de datos
relacional (Aurora, RDS) sería preferible si el modelo de datos necesitara
relaciones entre múltiples tipos de entidad, consultas ad-hoc complejas,
transacciones multi-fila, o restricciones relacionales estrictas —
ninguna de las cuales necesita esta simple lista de tareas.

**Un Lambda por ruta vs. un único Lambda.** Este proyecto usa
deliberadamente un Lambda por operación. Esto hace que la configuración
de rutas de API Gateway y la política IAM de cada función sean fáciles de
leer de forma aislada — puedes mirar el bloque de CDK de `create-item` y
ver exactamente qué tiene permitido hacer, sin leer la lógica interna de
despacho (dispatch) de un router. Un único Lambda que maneje todas las
rutas reduce la cantidad de funciones a desplegar y puede compartir más
rutas de código en memoria, pero también significa que cada ruta comparte
un mismo rol IAM (a menos que se divida más) y la lógica de enrutamiento
de un solo archivo, lo cual es más difícil de razonar para quien lo lee
por primera vez.

**CDK vs. SAM / Terraform / CloudFormation.** Este proyecto usa CDK para
demostrar infraestructura como código expresada en el mismo lenguaje
(TypeScript) que el código de la aplicación, con construcciones de
programación reales (bucles, funciones, tipos) disponibles al definir la
infraestructura. SAM, Terraform y CloudFormation escrito a mano son
formas igualmente válidas de desplegar esta misma arquitectura — la
elección aquí trata de demostrar CDK específicamente, no de afirmar que
sea superior a las alternativas.

## Estructura del repositorio

```text
aws-cdk-serverless-rest-api/
│
├── README.md                 Este archivo (inglés)
├── README.es.md               Versión en español de este archivo
│
├── package.json               Scripts y dependencias de npm
├── tsconfig.json               Configuración del compilador TypeScript
├── cdk.json                    Configuración de la CLI de CDK (punto de entrada de la app, contexto)
├── jest.config.js              Configuración del test runner Jest
│
├── bin/
│   └── aws-cdk-serverless-rest-api.ts   Punto de entrada de la app CDK; instancia el stack
│
├── lib/
│   └── serverless-rest-api-stack.ts     La definición completa de la infraestructura
│
├── src/
│   ├── handlers/                Cuatro pequeños entry points de Lambda, uno por ruta
│   │   ├── create-item.ts
│   │   ├── list-items.ts
│   │   ├── get-item.ts
│   │   └── delete-item.ts
│   │
│   ├── shared/                  Pequeños helpers compartidos entre handlers
│   │   ├── dynamodb.ts           Cliente de DynamoDB + lectura de la variable de entorno TABLE_NAME
│   │   ├── responses.ts          Constructores de respuestas de éxito/error estructuradas
│   │   └── validation.ts         Validación del cuerpo de la solicitud para POST /items
│   │
│   └── types/
│       └── item.ts               Tipos de TypeScript compartidos para un item de tarea
│
├── docs/
│   ├── architecture.md          Recorrido de arquitectura más profundo + diagramas de secuencia (inglés)
│   ├── security.md               Modelo de seguridad y matriz de permisos IAM (inglés)
│   ├── cost-considerations.md    Modelo de facturación por servicio (inglés)
│   ├── troubleshooting.md        Problemas comunes y cómo diagnosticarlos (inglés)
│   │
│   └── es/                       Versiones en español de todo lo anterior
│       ├── architecture.md
│       ├── security.md
│       ├── cost-considerations.md
│       └── troubleshooting.md
│
├── website/
│   ├── index.html                Página educativa estática que explica la arquitectura (inglés)
│   └── es/
│       └── index.html            Versión en español de la misma página
│
└── test/
    ├── stack.test.ts             Tests de aserciones de CDK contra la plantilla sintetizada
    └── handlers/
        ├── validation.test.ts    Tests unitarios para la validación de solicitudes
        └── responses.test.ts     Tests unitarios para los helpers de respuesta
```

## Objetivos de aprendizaje

Después de trabajar con este repositorio, deberías poder explicar:

* Cómo API Gateway invoca a Lambda, y cómo una ruta se mapea a una función
* Cómo Lambda accede a DynamoDB, y qué rol IAM lo hace posible
* Cómo funcionan las partition keys de DynamoDB, y por qué `id` encaja
  bien aquí
* Cómo CDK define infraestructura de AWS como TypeScript, y cómo
  `cdk synth` convierte eso en una plantilla de CloudFormation
* Cómo IAM controla exactamente qué puede hacer cada función Lambda
* Cómo una excepción de Lambda o un error de DynamoDB se convierte en una
  respuesta HTTP
* Dónde se almacenan los logs de la aplicación, y cómo encontrar el log
  de una solicitud fallida específica
* Cómo se puede probar la infraestructura con aserciones de CDK, antes de
  desplegar nada
* Cómo desplegar este stack, y cómo destruirlo por completo después
