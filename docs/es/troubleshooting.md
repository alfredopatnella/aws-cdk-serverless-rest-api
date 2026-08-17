# Solución de problemas

🌐 Idioma: [English](../troubleshooting.md) | **Español**

Soluciones prácticas para los problemas más probables al construir,
probar y desplegar este proyecto.

## Error de bootstrap de CDK

**Síntoma:** `cdk deploy` falla con un error que menciona que el entorno
no ha sido inicializado con bootstrap, o falta el stack `CDKToolkit` /
un parámetro de SSM.

**Solución:** Cada combinación de cuenta/región de AWS necesita hacerse
bootstrap una vez antes de poder alojar stacks desplegados con CDK.
Ejecuta:

```bash
npx cdk bootstrap
```

Esto crea un pequeño stack de soporte (un bucket de S3 y roles IAM de
soporte) que CDK usa para almacenar temporalmente los assets de
despliegue, como el código Lambda empaquetado que produce
`NodejsFunction`. Solo necesitas hacer esto una vez por cuenta/región,
no antes de cada despliegue.

## Credenciales de AWS no configuradas

**Síntoma:** `cdk synth`, `cdk deploy`, o `cdk bootstrap` fallan con un
error de credenciales o "Unable to locate credentials".

**Solución:** Confirma que la CLI puede resolver credenciales:

```bash
aws sts get-caller-identity
```

Si esto falla, configura un perfil (`aws configure` o
`aws configure sso`, según cómo tu organización otorgue acceso), y luego
exporta `AWS_PROFILE=<nombre-de-perfil>` o pasa `--profile` a los
comandos `cdk`. CDK usa la misma resolución de credenciales que la CLI de
AWS — lo que resuelva `aws sts get-caller-identity` es lo que CDK usará.

## Lambda no puede acceder a DynamoDB

**Síntoma:** Las llamadas a la API devuelven `500 Internal Server
Error`, y la causa subyacente es una `AccessDeniedException` de
DynamoDB.

**Causa:** Cada Lambda de este stack tiene una política IAM acotada que
otorga exactamente una acción de DynamoDB (ver `docs/es/security.md`).
Si el stack fue modificado y un handler ahora llama a una acción de
DynamoDB distinta de la que su política permite, la llamada será
denegada.

**Solución:** Revisa los CloudWatch Logs de la función (ver abajo) para
ver el mensaje exacto de `AccessDeniedException` — nombra la acción y el
recurso faltantes. Actualiza la `PolicyStatement` correspondiente en
`lib/serverless-rest-api-stack.ts` para que coincida, y luego vuelve a
desplegar.

## La API devuelve 500

**Síntoma:** Una solicitud a cualquier endpoint devuelve
`{ "error": { "code": "INTERNAL_ERROR", ... } }`.

**Solución:** El handler ya registró la causa real en CloudWatch antes
de devolver la respuesta genérica. Encuentra el grupo de logs (Log
Group) correspondiente — cada función tiene el suyo propio, nombrado
según el ID de su construct de CDK (por ejemplo, `CreateItemLogGroup`) —
y busca una línea de log estructurada de nivel `ERROR` que coincida con
el timestamp de la solicitud. Usando la AWS CLI:

```bash
aws logs tail /aws/lambda/<nombre-de-la-función> --since 15m --follow
```

(Ejecuta `aws lambda list-functions --query "Functions[].FunctionName"`
si no tienes ya el nombre exacto de la función desplegada — CDK genera un
nombre físico con sufijo a menos que se codifique uno manualmente.)

## La API devuelve un error de validación

**Síntoma:** `POST /items` devuelve `400` con `VALIDATION_ERROR`.

**Solución:** Confirma que el cuerpo de la solicitud sea JSON válido con
un string `title` no vacío:

```bash
curl -X POST "$API_URL/items" \
  -H "Content-Type: application/json" \
  -d '{"title":"Learn AWS CDK"}'
```

Errores comunes: omitir `-H "Content-Type: application/json"`, enviar
`title` como número o `null`, o enviar un `title` vacío o compuesto solo
por espacios en blanco.

## El despliegue de CDK falla

**Síntoma:** `cdk deploy` falla a mitad de camino, o CloudFormation
muestra un estado de stack `ROLLBACK_COMPLETE` / `UPDATE_ROLLBACK_COMPLETE`.

**Solución:** Primero confirma que el stack aún sintetiza correctamente:

```bash
npx cdk synth
```

Si el synth tiene éxito pero el deploy falla, el error proviene de
CloudFormation mismo — lee la razón del fallo en la salida de la CLI, o
abre la pestaña **Events** del stack en la consola de CloudFormation
para ver el recurso específico y la razón. Si el stack queda atascado en
`ROLLBACK_COMPLETE`, generalmente necesita eliminarse
(`npx cdk destroy`, o eliminarlo desde la consola) antes de poder
desplegarse de nuevo.

## Errores de compilación de TypeScript

**Síntoma:** `npm run build` reporta errores de tipos.

**Solución:** Ejecuta el build directamente para ver la lista completa
de errores con archivo y número de línea:

```bash
npm run build
```

`tsc` no emitirá salida mientras haya errores de tipos bajo la
configuración `strict` del compilador de este proyecto — corrige los
errores reportados y vuelve a ejecutar.

## Fallan las pruebas

**Síntoma:** `npm test` reporta aserciones fallidas.

**Solución:** Ejecuta la suite directamente y lee la salida del fallo —
Jest imprime el valor esperado vs. el valor real para cada aserción
fallida:

```bash
npm test
```

Si falla una aserción de `test/stack.test.ts` después de un cambio en
`lib/serverless-rest-api-stack.ts`, normalmente significa que el cambio
alteró una de las propiedades arquitectónicas que el test protege (por
ejemplo, el esquema de claves de DynamoDB, la cantidad de funciones
Lambda, o las acciones de una política IAM) — confirma que el cambio fue
intencional antes de actualizar el test.

## Falla el destroy

**Síntoma:** `npx cdk destroy` falla, o CloudFormation muestra un estado
`DELETE_FAILED`.

**Causa:** Esto normalmente es un problema de dependencia entre recursos
— por ejemplo, un recurso que CloudFormation no creó (o que fue
modificado fuera de CloudFormation) bloqueando la eliminación de algo
que depende de él.

**Solución:** Revisa la razón específica del fallo en la salida de la
CLI o en la pestaña **Events** de la consola de CloudFormation para el
recurso que no pudo eliminarse. Reintentar `npx cdk destroy` después de
resolver el problema que lo bloquea (por ejemplo, eliminando manualmente
un recurso que CloudFormation ya no rastrea) típicamente completa la
eliminación. Como la tabla de DynamoDB de este proyecto usa
`RemovalPolicy.DESTROY`, la tabla en sí no es una causa común de fallos
de eliminación aquí.
