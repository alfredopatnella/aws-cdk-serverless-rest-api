# Seguridad

🌐 Idioma: [English](../security.md) | **Español**

Este documento explica la postura de seguridad de la arquitectura de
referencia: qué está implementado, qué se deja fuera intencionalmente por
claridad didáctica, y qué agregaría un despliegue de producción.

## Modelo de seguridad

El modelo de amenazas de este ejemplo es deliberadamente acotado. Los
objetivos son:

* Cada función Lambda puede realizar únicamente la única acción de
  DynamoDB que necesita — nada más.
* Toda entrada proveniente de clientes se trata como no confiable y se
  valida antes de usarse.
* Los fallos internos (errores del SDK, excepciones, stack traces) nunca
  llegan al cliente; solo llega un pequeño conjunto predecible de formas
  de error.
* El tráfico hacia la API está cifrado en tránsito (HTTPS, exigido por
  API Gateway).

La autenticación y autorización de quienes *llaman* a la API están
explícitamente fuera de alcance — ver [Autenticación](#autenticación) más
abajo.

## Mínimo privilegio en IAM

Cada función Lambda tiene su propio rol de ejecución IAM, generado por
CDK, y su propia `PolicyStatement` que otorga exactamente una acción de
DynamoDB, limitada a la única tabla de este stack:

| Lambda         | Permiso de DynamoDB | Recurso              |
| -------------- | -------------------- | --------------------- |
| `create-item`  | `PutItem`             | Solo el ARN de `ItemsTable` |
| `list-items`   | `Scan`                | Solo el ARN de `ItemsTable` |
| `get-item`     | `GetItem`             | Solo el ARN de `ItemsTable` |
| `delete-item`  | `DeleteItem`          | Solo el ARN de `ItemsTable` |

Ninguno de estos roles puede llamar a `dynamodb:*`, y ninguno puede leer
ni escribir en una tabla distinta a la que crea este stack.
`test/stack.test.ts` verifica esto directamente: hace fallar el build si
alguna declaración de política IAM en la plantilla sintetizada otorga
`dynamodb:*`.

Permisos amplios (`table.grantReadWriteData()`, `dynamodb:*`, o un único
rol compartido para las cuatro funciones) funcionarían igual, pero
significarían que un bug o una vulnerabilidad en `list-items` podría, en
principio, usarse para eliminar datos — aunque `list-items` nunca
necesita eliminar nada. Limitar cada rol a exactamente lo que su función
hace elimina por completo ese modo de fallo.

## Validación de entrada

La entrada del cliente nunca es confiable. Dos capas validan el cuerpo de
la solicitud de `POST /items`:

1. **Validación de solicitud en API Gateway.** Un modelo JSON Schema
   exige que el cuerpo sea JSON válido y contenga un string `title` no
   vacío. Las solicitudes que fallan esta verificación se rechazan antes
   de que se invoque siquiera una Lambda.
2. **Validación del lado de Lambda** (`src/shared/validation.ts`). La
   Lambda vuelve a validar de forma independiente que el cuerpo exista,
   que se pueda parsear como JSON, y que contenga un string `title` de
   longitud acotada. Esta capa existe porque la Lambda no puede asumir
   que cada invocación llegó a través de esta configuración específica de
   API Gateway con la validación habilitada — invocaciones directas de
   prueba, una futura segunda API delante de la misma función, o una
   mala configuración podrían todas saltarse la verificación de API
   Gateway. Volver a validar en el código de la aplicación es lo que
   efectivamente hace cumplir la regla.

La defensa en profundidad de este tipo es un patrón común y deliberado:
cada capa protege contra un conjunto distinto de modos de fallo, y
ninguna capa por sí sola es una garantía completa.

## Manejo de errores

Los handlers capturan errores del SDK de AWS y excepciones inesperadas,
registran los detalles en CloudWatch, y devuelven una respuesta genérica
`{ "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred" } }`.
El mensaje de excepción crudo, el stack trace, y cualquier metadato de
error específico de AWS permanecen solo en CloudWatch y nunca se incluyen
en el cuerpo de la respuesta HTTP.

Esto importa porque los mensajes de error del SDK de AWS pueden revelar
detalles internos (nombres de tabla, nombres de roles IAM,
identificadores específicos de la cuenta) que son útiles para un
atacante e irrelevantes para un cliente legítimo que intenta corregir una
solicitud incorrecta.

## Registro de logs (Logging)

Los handlers registran líneas JSON estructuradas que contienen el nombre
de la operación, el `requestId` de API Gateway, y (en caso de error) el
mensaje de la excepción — suficiente para trazar una solicitud fallida
específica a través de CloudWatch. Los handlers deliberadamente evitan
registrar el cuerpo completo de la solicitud o cualquier campo que no sea
necesario para el diagnóstico, ya que los cuerpos de solicitud son
suministrados por el usuario y podrían llegar a contener datos que no
deberían persistirse en logs.

## Autenticación

**La autenticación se omite intencionalmente en este ejemplo educativo.**
Cualquier ruta puede ser invocada públicamente por cualquiera que tenga
la URL de la API. Esto mantiene el ejemplo ejecutable con un único
comando `curl` y sin configuración de un proveedor de identidad, lo cual
importa para un repositorio pensado para leerse y probarse en una sola
sesión.

Un despliegue de producción de esta arquitectura agregaría uno de los
siguientes:

* **Amazon Cognito** — los user pools emiten JWTs para usuarios finales;
  API Gateway puede validarlos directamente mediante un autorizador de
  Cognito.
* **Autorizadores JWT (JWT authorizers)** — API Gateway puede validar
  JWTs de cualquier proveedor de identidad compatible con OIDC, no solo
  Cognito.
* **Autorización IAM** — para llamadas de servicio a servicio dentro de
  un entorno de AWS, API Gateway puede exigir solicitudes firmadas con
  SigV4 validadas contra políticas IAM.
* **Autorizadores Lambda personalizados (custom Lambda authorizers)** —
  para esquemas de autenticación a medida (API keys, tokens de terceros),
  una Lambda authorizer se ejecuta antes de la función destino y devuelve
  una política IAM que permite o deniega la solicitud.

Cualquiera de estas opciones se ubicaría delante de las rutas existentes
en `lib/serverless-rest-api-stack.ts` sin requerir cambios en los
handlers de Lambda, ya que la autorización ocurre en la capa de API
Gateway.

## Seguridad de DynamoDB

DynamoDB cifra todos los datos en reposo por defecto, usando claves de
cifrado propiedad de AWS, sin configuración adicional requerida. Para
cargas de trabajo con requisitos de cumplimiento más estrictos, una tabla
puede en su lugar usar una clave KMS administrada por AWS o administrada
por el cliente. Este ejemplo se apoya en el cifrado por defecto, ya que
introducir gestión de claves personalizada agregaría complejidad sin un
beneficio didáctico correspondiente a esta escala.

## Mejoras de seguridad de la API para producción

Más allá de la autenticación, un despliegue de nivel producción de esta
misma arquitectura típicamente agregaría:

* **AWS WAF** delante de API Gateway, para filtrar exploits web comunes y
  patrones de solicitud maliciosos.
* **Throttling y usage plans**, para limitar la tasa de solicitudes por
  cliente y proteger el backend de ser sobrecargado.
* **Políticas de recursos (resource policies)**, para restringir qué
  cuentas de AWS, VPCs, o rangos de IP pueden invocar la API.
* **APIs privadas** (API Gateway con un VPC endpoint), cuando la API
  nunca debería ser alcanzable desde internet público.
* **AWS CloudTrail**, para registrar llamadas a la API del plano de
  administración (quién cambió la infraestructura, y cuándo) con fines de
  auditoría.
* **Alarmas de CloudWatch**, para avisar a una persona cuando las tasas
  de error, el throttling, o la latencia superen un umbral.
* **Gestión de secretos** (AWS Secrets Manager o SSM Parameter Store),
  para cualquier credencial o API key que la aplicación necesite — este
  ejemplo no tiene ninguna, ya que solo habla con DynamoDB usando su rol
  de ejecución IAM.

Nada de esto está implementado aquí, porque cada elemento agrega
superficie operativa que no es necesaria para entender cómo encajan API
Gateway, Lambda y DynamoDB — que es el objetivo de este repositorio.
