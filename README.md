# Serverless REST API with AWS CDK

🌐 Language: **English** | [Español](README.es.md)

A deliberately small reference architecture demonstrating how to build,
deploy, secure, test, and operate a serverless REST API using API
Gateway, AWS Lambda, DynamoDB, TypeScript, and AWS CDK.

## Overview

This repository implements a small **Task API** — `POST /items`,
`GET /items`, `GET /items/{id}`, `DELETE /items/{id}` — using nothing but
managed AWS services and infrastructure-as-code. It's built for:

* Software developers learning AWS
* Developers learning AWS CDK
* Cloud engineers
* Junior and intermediate cloud architects
* Engineering managers who want to understand the architecture
* Developers transitioning from traditional REST applications (Express,
  Django, Rails, Spring, ...) to serverless AWS architectures

The project intentionally avoids complex abstractions — no web framework,
no ORM, no dependency-injection container, no multi-environment pipeline.
The goal is that someone can read every file in `lib/` and `src/` in one
sitting and understand exactly what AWS builds and why, without a
framework's conventions standing between them and the underlying AWS
services. Every design decision below trades some production
sophistication for teaching clarity; the [Production
considerations](#production-considerations) section is explicit about
where that line was drawn.

## Architecture

```text
                  ┌──────────────────────┐
                  │        Client        │
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
                  │ TypeScript handlers  │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │      DynamoDB        │
                  │ Partition key: id    │
                  └──────────────────────┘

        Supporting services used throughout the stack:
        IAM (per-function permissions), CloudWatch (logs),
        CDK / CloudFormation (defines and deploys everything above)
```

* **API Gateway** is the one public entry point. It terminates HTTPS,
  matches the request path/method, optionally validates the request body,
  and invokes the matching Lambda function.
* **Lambda** runs the application logic — one small TypeScript function
  per operation. No server to patch, provision, or scale manually.
* **DynamoDB** is the persistent store — a single table keyed by `id`.
* **IAM** grants each Lambda function only the one DynamoDB action it
  performs.
* **CloudWatch** receives logs from every Lambda invocation and from API
  Gateway's access logs.
* **CDK** defines all of the above as TypeScript and turns it into a
  CloudFormation template that AWS actually deploys.

See [docs/architecture.md](docs/architecture.md) for a deeper walkthrough,
including a sequence diagram for every route.

## What problem does this architecture solve?

This pattern is a common default for small-to-medium HTTP APIs because it
answers several problems at once, with mostly managed services:

* **Exposing an HTTPS API** — API Gateway provides TLS termination, a
  stable URL, and request routing without running a load balancer or web
  server.
* **Executing application logic without managing servers** — Lambda runs
  your code on demand; there is no EC2 instance or container to patch,
  monitor for CPU/memory, or keep warm.
* **Persisting application state** — DynamoDB stores data durably across
  requests and Lambda invocations (Lambda itself has no persistent local
  state).
* **Scaling automatically** — API Gateway, Lambda, and DynamoDB (in
  on-demand mode) all scale with traffic without manual capacity planning.
* **Paying primarily for usage** — all three core services bill on
  requests/invocations/capacity consumed rather than on reserved,
  always-on capacity. See [Cost](#cost).
* **Deploying infrastructure repeatably** — the entire architecture is
  defined in code (CDK) and can be created, updated, or destroyed
  deterministically, instead of being clicked together in a console.

## Request lifecycle

### POST /items

```text
1. Client sends an HTTPS request with a JSON body: { "title": "..." }.
2. API Gateway receives the request.
3. API Gateway matches POST /items and validates the body against a JSON Schema model.
4. API Gateway invokes the create-item Lambda function.
5. Lambda re-validates the request body (defense in depth).
6. Lambda generates a UUID, createdAt timestamp, and completed=false.
7. Lambda calls DynamoDB PutItem to store the task.
8. DynamoDB confirms the write.
9. Lambda builds a 201 Created HTTP response containing the new item as JSON.
10. API Gateway returns that response to the client.
```

### GET /items and GET /items/{id}

`GET /items` follows the same shape, but the `list-items` Lambda calls
DynamoDB `Scan` and returns every item as a JSON array with `200 OK`.

`GET /items/{id}` calls DynamoDB `GetItem` with the `id` path parameter.
If the item exists, the Lambda returns `200 OK` with the item; if not, it
returns `404 Not Found` with a structured error body — DynamoDB simply
reports "no item," and the Lambda is what turns that into an HTTP status.

### DELETE /items/{id}

The `delete-item` Lambda calls DynamoDB `DeleteItem` with a condition
expression requiring the item to already exist. If it did, the Lambda
returns `204 No Content`. If it didn't, DynamoDB reports a conditional
check failure, which the Lambda translates into `404 Not Found` instead of
silently reporting success for a no-op delete.

## AWS resources created

| Resource                              | Purpose                                                        |
| -------------------------------------- | ---------------------------------------------------------------- |
| API Gateway REST API                   | Public HTTPS entry point; routes requests to Lambda              |
| 4 Lambda functions                     | Application logic for create/list/get/delete                     |
| DynamoDB table                         | Persistent storage for task items, keyed by `id`                 |
| 4 IAM execution roles + policies       | One per Lambda, each scoped to a single DynamoDB action          |
| 5 CloudWatch Log Groups                | One per Lambda function, plus one for API Gateway access logs    |

CDK/CloudFormation also provisions supporting resources automatically —
for example, an API Gateway deployment and stage, and a Lambda permission
resource per route granting API Gateway the right to invoke each
function. These aren't hand-authored; CDK generates them as a consequence
of the constructs above.

## DynamoDB data model

Each item is stored as:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "title": "Prepare architecture documentation",
  "completed": false,
  "createdAt": "2026-08-13T12:00:00.000Z"
}
```

**Partition key: `id` (string).** A DynamoDB partition key is the
attribute DynamoDB hashes to decide which internal storage partition an
item is physically stored on. Every read or write must supply this key
(directly, or via a query on it) — DynamoDB has no concept of scanning a
single partition "by row number" the way a relational table might.

`id` works well here because every access to a *specific* item — a
`GetItem` or `DeleteItem` — happens by an opaque identifier the client
received when the item was created. There's no need to look items up by
title, date, or any other attribute in this example, so a single string
partition key is sufficient; no secondary indexes are needed.

This is exactly why `GET /items/{id}` and `DELETE /items/{id}` are cheap,
constant-time operations: DynamoDB routes the request directly to the
partition holding that key with `GetItem`/`DeleteItem`, instead of
inspecting every item in the table.

Listing *all* items (`GET /items`), by contrast, has no key to look up by
— "give me everything" isn't a partition-key query. This example uses a
DynamoDB `Scan`, which reads every item in the table. That's simple and
correct at the scale this project is meant to run at (a personal demo
table with a handful of items), but `Scan` cost and latency both grow
with total table size, not with the number of items you actually want
back. A production workload with a large or growing table would replace
this with either a `Query` against a well-chosen key/index (if there's a
natural way to partition "list" requests, such as by owner) or paginated,
rate-limited scanning — see [Production
considerations](#production-considerations).

## Error handling

Every response — success or failure — is JSON with a `Content-Type:
application/json` header. Errors always follow the same shape:

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

* **Validation errors** (`400`) happen when the request body fails
  validation — missing/blank/non-string `title`, malformed JSON, or a
  missing body.
* **Not-found errors** (`404`) happen when `GET`/`DELETE` target an `id`
  that doesn't exist in the table.
* **Unexpected errors** (`500`) happen when something fails that isn't a
  validation or not-found case — for example, a DynamoDB service error.
  The client only ever sees the generic message above; the real
  exception is logged to CloudWatch (see [Security](#security)) so it can
  be diagnosed without exposing internals to callers.

## Security

* **Least privilege** — every Lambda's IAM role grants exactly one
  DynamoDB action, scoped to this one table. No function can call
  `dynamodb:*`, and none can touch a table other than its own.
* **HTTPS everywhere** — API Gateway only serves HTTPS.
* **IAM execution roles** — each Lambda runs under its own role; there is
  no shared "do everything" role.
* **Input validation** — enforced both at API Gateway (a JSON Schema
  request model) and inside the Lambda itself.
* **No secrets in source code** — the project has no credentials to
  manage; Lambda authenticates to DynamoDB using its IAM execution role.
* **No internal exception disclosure** — clients receive a generic
  `INTERNAL_ERROR` message; details go to CloudWatch only.

**Authentication is intentionally not implemented in this demo.** Every
route is publicly callable by anyone with the API URL. A production
deployment would add one of: **Amazon Cognito**, a **JWT authorizer**,
**IAM authorization**, or a **custom Lambda authorizer** in front of the
existing routes. See [docs/security.md](docs/security.md) for the full
security model, the per-function IAM permission matrix, and a longer
discussion of production authentication options.

## Cost

This architecture is generally inexpensive at low traffic because API
Gateway, Lambda, and DynamoDB (in on-demand mode) all bill primarily on
**usage** rather than reserved, always-on capacity:

* **API Gateway** — billed per million API requests, plus data transfer.
* **Lambda** — billed per invocation and per execution duration ×
  memory allocated.
* **DynamoDB** — billed per read/write request unit consumed (on-demand
  mode), plus storage.
* **CloudWatch** — billed for log ingestion, log storage, and metrics.

This project does **not** hard-code specific dollar amounts, since AWS
pricing varies by region and changes over time. See
[docs/cost-considerations.md](docs/cost-considerations.md) for a fuller
explanation of each billing dimension and a low-volume illustrative
scenario. Use the [AWS Pricing Calculator](https://calculator.aws/) for
an estimate based on your actual expected traffic before relying on any
number.

## Deployment

```bash
npm install
npm run build
npm test
npx cdk synth
npx cdk deploy
```

If this is the first time deploying a CDK application into this AWS
account/region, bootstrap it first (a one-time step per account/region):

```bash
npx cdk bootstrap
```

`cdk deploy` prints stack outputs when it finishes, including:

```text
Outputs:
ServerlessRestApiStack.ApiUrl = https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/
```

Save that value as `API_URL` for the examples below:

```bash
export API_URL="https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod"
```

## Testing the API

```bash
# Create an item
curl -X POST "$API_URL/items" \
  -H "Content-Type: application/json" \
  -d '{"title":"Learn AWS CDK"}'
# -> 201 Created
# { "id": "...", "title": "Learn AWS CDK", "completed": false, "createdAt": "..." }
```

```bash
# List all items
curl "$API_URL/items"
# -> 200 OK
# [ { "id": "...", "title": "Learn AWS CDK", ... } ]
```

```bash
# Get one item (replace <id> with an id returned above)
curl "$API_URL/items/<id>"
# -> 200 OK, the item JSON
# or 404 Not Found if the id doesn't exist:
# { "error": { "code": "NOT_FOUND", "message": "Item was not found" } }
```

```bash
# Delete an item
curl -i -X DELETE "$API_URL/items/<id>"
# -> 204 No Content on success
# -> 404 Not Found if the id doesn't exist
```

## Destroying the stack

```bash
npx cdk destroy
```

This deletes every resource CDK created for this stack — the API Gateway
API, all four Lambda functions, their IAM roles/policies, the CloudWatch
Log Groups, and **the DynamoDB table itself, including its data**.

The table is configured with `RemovalPolicy.DESTROY` specifically so this
project can be fully cleaned up with one command and leave nothing
behind. Production databases almost never use `DESTROY` — they typically
use `RemovalPolicy.RETAIN` (so the table survives even if the stack is
deleted) combined with backups and/or point-in-time recovery, so that
deleting infrastructure can never accidentally delete data.

## What happens when something fails?

| Scenario                          | Where it's caught                          | What the client sees |
| ---------------------------------- | -------------------------------------------- | ----------------------- |
| Invalid JSON body                  | API Gateway model validation, then Lambda    | `400 VALIDATION_ERROR` |
| Missing/blank `title`              | API Gateway model validation, then Lambda    | `400 VALIDATION_ERROR` |
| Nonexistent item (`GET`/`DELETE`)  | Lambda, after querying DynamoDB              | `404 NOT_FOUND` |
| DynamoDB service failure           | Lambda `catch` block                         | `500 INTERNAL_ERROR` (details in CloudWatch) |
| Unhandled Lambda exception         | Lambda `catch` block                         | `500 INTERNAL_ERROR` (details in CloudWatch) |
| Insufficient IAM permissions       | DynamoDB SDK call throws `AccessDeniedException`, caught like any other SDK error | `500 INTERNAL_ERROR` (the `AccessDeniedException` is visible in CloudWatch) |

In every failure case, the client receives one of the three structured
error shapes from [Error handling](#error-handling) — never a raw AWS SDK
error or stack trace. The full detail always lands in CloudWatch first,
which is why CloudWatch is the starting point for diagnosing any failure
— see [docs/troubleshooting.md](docs/troubleshooting.md).

## Production considerations

This project is a teaching reference, not a production template. Moving
this architecture toward production would typically mean adding:

* **Authentication and authorization** (Cognito, JWT/IAM/custom
  authorizers — see [Security](#security))
* **A custom domain** instead of the default `execute-api` URL
* **AWS WAF** in front of the API
* **Throttling and API usage quotas** per client
* **Pagination** for `GET /items` instead of returning the entire table
* **Avoiding unrestricted DynamoDB `Scan`** as the table grows
* **Observability**: correlation IDs, custom metrics, and dashboards
* **CloudWatch alarms** for error rates, throttling, and latency
* **Distributed tracing** (AWS X-Ray) across API Gateway → Lambda → DynamoDB
* **Stronger schema validation** (e.g., OpenAPI-driven validation)
* **Idempotency** handling for retried `POST` requests
* **Rate limiting** beyond what API Gateway usage plans provide
* **CI/CD** to build, test, and deploy on every change
* **Multiple environments** (dev/staging/prod) with separate stacks
* **Backups / point-in-time recovery** for DynamoDB
* **A more conservative removal policy** (`RETAIN` instead of `DESTROY`)
* **API versioning** as the contract evolves
* **Structured metrics** beyond logs (e.g., embedded metric format)
* **Secrets management** for any credential the application needs

The point of this list isn't that every item is hard — most are a few
lines of CDK. The point is to make the *gap* between an educational
reference architecture and a production one explicit, rather than
implying this repository is production-ready as-is.

## Architectural alternatives considered

**API Gateway REST API vs. HTTP API.** This project uses a REST API
because it lets the example demonstrate request validation models and
CloudWatch access logging directly in CDK — useful teaching material.
HTTP APIs are generally simpler and cheaper per request when those REST-
API-specific features aren't needed; they're a reasonable default for a
new API that doesn't require them.

**Lambda vs. containers.** Lambda fits this workload well: short,
stateless, bursty request/response handlers with no long-running
processes. ECS/Fargate or App Runner would make more sense for
long-running processes, workloads needing a custom runtime or large
dependencies, consistently high and steady traffic (where always-on
compute can be cheaper than per-invocation billing), or applications that
need more control over the execution environment than Lambda provides.

**DynamoDB vs. a relational database.** DynamoDB fits an access pattern
of "read/write one item by an opaque key, plus list everything" with no
joins or multi-table transactions. A relational database (Aurora, RDS)
would be preferable if the data model needed relationships between
multiple entity types, complex ad-hoc queries, multi-row transactions, or
strong relational constraints — none of which this simple task list
needs.

**One Lambda per route vs. a single Lambda.** This project deliberately
uses one Lambda per operation. It makes the API Gateway routing config
and each function's IAM policy easy to read in isolation — you can look
at `create-item`'s CDK block and see exactly what it's allowed to do,
without reading a router's internal dispatch logic. A single Lambda
handling all routes reduces the number of functions to deploy and can
share more code paths in memory, but it also means every route shares one
IAM role (unless split further) and one file's worth of routing logic,
which is harder to reason about for a first-time reader.

**CDK vs. SAM / Terraform / CloudFormation.** This project uses CDK to
demonstrate infrastructure-as-code expressed in the same language
(TypeScript) as the application code, with real programming constructs
(loops, functions, types) available when defining infrastructure. SAM,
Terraform, and hand-written CloudFormation are all equally valid ways to
deploy this same architecture — the choice here is about demonstrating
CDK specifically, not a claim that it's superior to the alternatives.

## Repository structure

```text
aws-cdk-serverless-rest-api/
│
├── README.md                 This file
│
├── package.json               npm scripts and dependencies
├── tsconfig.json               TypeScript compiler configuration
├── cdk.json                    CDK CLI configuration (app entry point, context)
├── jest.config.js              Jest test runner configuration
│
├── bin/
│   └── aws-cdk-serverless-rest-api.ts   CDK app entry point; instantiates the stack
│
├── lib/
│   └── serverless-rest-api-stack.ts     The entire infrastructure definition
│
├── src/
│   ├── handlers/                Four small Lambda entry points, one per route
│   │   ├── create-item.ts
│   │   ├── list-items.ts
│   │   ├── get-item.ts
│   │   └── delete-item.ts
│   │
│   ├── shared/                  Small helpers shared across handlers
│   │   ├── dynamodb.ts           DynamoDB client + TABLE_NAME env lookup
│   │   ├── responses.ts          Structured success/error response builders
│   │   └── validation.ts         POST /items request body validation
│   │
│   └── types/
│       └── item.ts               Shared TypeScript types for a task item
│
├── docs/
│   ├── architecture.md          Deeper architecture walkthrough + sequence diagrams
│   ├── security.md               Security model and IAM permission matrix
│   ├── cost-considerations.md    Billing model per service
│   └── troubleshooting.md        Common problems and how to diagnose them
│
├── website/
│   └── index.html                Static educational page explaining the architecture
│
└── test/
    ├── stack.test.ts             CDK assertion tests against the synthesized template
    └── handlers/
        ├── validation.test.ts    Unit tests for request validation
        └── responses.test.ts     Unit tests for response helpers
```

## Learning objectives

After working through this repository, you should be able to explain:

* How API Gateway invokes Lambda, and how a route maps to a function
* How Lambda accesses DynamoDB, and what IAM role makes that possible
* How DynamoDB partition keys work, and why `id` is a good fit here
* How CDK defines AWS infrastructure as TypeScript, and how `cdk synth`
  turns that into a CloudFormation template
* How IAM controls exactly what each Lambda function is allowed to do
* How a Lambda exception or a DynamoDB error becomes an HTTP response
* Where application logs are stored, and how to find the log for a
  specific failed request
* How infrastructure can be tested with CDK assertions, before anything
  is deployed
* How to deploy this stack, and how to fully destroy it afterward
