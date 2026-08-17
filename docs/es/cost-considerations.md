# Consideraciones de costos

🌐 Idioma: [English](../cost-considerations.md) | **Español**

Este documento explica el *modelo de facturación* de cada servicio usado
en esta arquitectura — no precios exactos, que cambian con el tiempo y
varían según la región. Para una estimación real, usa la
[Calculadora de precios de AWS](https://calculator.aws/) con tu tráfico
esperado, o consulta la página de precios vigente de cada servicio.

## API Gateway

Las REST APIs se facturan principalmente por **millón de solicitudes de
API recibidas**, más **transferencia de datos de salida**. No hay cargo
por una API que no recibe tráfico. El caching, si se habilita, agrega un
cargo por hora — este proyecto no habilita caching.

## Lambda

Lambda se factura por **número de invocaciones** y **duración de
ejecución redondeada hacia arriba, multiplicada por la memoria
asignada**. Una función que se ejecuta unos pocos cientos de
milisegundos con poca memoria (este proyecto usa 128 MB) cuesta una
pequeña fracción de centavo por invocación a precios típicos. AWS
también ofrece una capa gratuita mensual tanto para invocaciones como
para duración de cómputo que cubre cómodamente el uso ocasional de este
proyecto.

## DynamoDB

Esta tabla usa **capacidad on-demand** (`BillingMode.PAY_PER_REQUEST`),
que factura por **unidad de solicitud de lectura** y **unidad de
solicitud de escritura** consumidas, más almacenamiento. El modo
on-demand se eligió sobre la capacidad aprovisionada porque no requiere
planificación de capacidad y su costo escala a cero cuando la tabla no
recibe tráfico — apropiado para un proyecto que puede permanecer inactivo
entre sesiones de aprendizaje. Una carga de trabajo de producción
constante, predecible y de alto volumen podría cambiar a capacidad
aprovisionada (opcionalmente con auto scaling) para un costo menor por
solicitud.

Las operaciones `Scan` (usadas por `GET /items`) consumen capacidad de
lectura proporcional al tamaño de *toda la tabla*, no solo a los items
devueltos — esta es una de las razones por las que una tabla de
producción en crecimiento debería alejarse de `Scan` como su endpoint de
listado principal. Ver [docs/es/architecture.md](architecture.md) para el
razonamiento detrás de usar `Scan` aquí de todas formas.

## CloudWatch

CloudWatch factura por **volumen de ingesta de logs**, **almacenamiento
de logs**, y **métricas personalizadas**, entre otras dimensiones. Este
proyecto establece un período explícito de retención de logs de una
semana en cada grupo de logs específicamente para acotar el costo de
almacenamiento — sin una configuración de retención, los logs de
CloudWatch se conservan indefinidamente por defecto.

## CDK / CloudFormation

CDK y CloudFormation en sí mismos son gratuitos de usar. `cdk synth` y
`cdk deploy` no generan cargos de AWS más allá del costo de los recursos
que crean — la tabla de DynamoDB, las funciones Lambda, la API de API
Gateway, los roles IAM, y los grupos de logs de CloudWatch descritos
arriba. CloudFormation no cobra por el stack en sí, solo por los recursos
que aprovisiona.

## Ejemplo de bajo volumen

Como escenario ilustrativo (no garantizado), considera:

```text
1,000 solicitudes de API por día
Ejecuciones de Lambda con un promedio muy por debajo de un segundo, a 128 MB de memoria
Items pequeños de DynamoDB (muy por debajo de 1 KB cada uno)
Volumen de logs limitado a unas pocas líneas estructuradas por solicitud
```

A este volumen, es probable que los cuatro servicios anteriores queden
dentro, o muy cerca, de la capa gratuita y de los niveles de precios de
bajo volumen de cada servicio, y el costo mensual total suele ser bajo —
a menudo cercano a cero para una persona desarrolladora individual
experimentando con el proyecto. Esto es una expectativa general, no una
estimación de factura; los cargos reales dependen de tu cuenta de AWS, tu
región, y cualquier otro recurso que esta contenga. Confirma siempre el
pricing vigente con la Calculadora de precios de AWS antes de confiar en
una estimación de costo.

## Optimización de costos

Si este proyecto se extendiera hacia un uso en producción, las palancas
de costo más relevantes serían:

* **HTTP API en lugar de REST API** — las HTTP APIs son en general más
  económicas por solicitud cuando no se necesitan las características
  adicionales de REST API (modelos de validación de solicitud, usage
  plans, políticas de recursos).
* **Retención de logs de CloudWatch** — ya está configurada
  explícitamente aquí; sin una política de retención, el costo de
  almacenamiento de logs crece sin límite con el tiempo.
* **Patrones de acceso de DynamoDB** — reemplazar `Scan` por operaciones
  `Query` dirigidas (respaldadas por una clave o índice adecuado) a
  medida que la tabla crece, ya que el costo de `Scan` escala con el
  tamaño total de la tabla en lugar de con el tamaño del resultado.
* **Evitar scans innecesarios** — por ejemplo, agregar filtros o
  paginación en lugar de escanear y devolver toda una tabla en cada
  solicitud.
* **Ajuste de memoria/runtime de Lambda** — el costo de Lambda escala con
  la memoria asignada y la duración en conjunto, así que perfilar una
  función y ajustar su memoria puede reducir el costo, aunque más
  memoria a veces puede *reducir* el costo total al terminar más rápido.
