# Cost Considerations

🌐 Language: **English** | [Español](es/cost-considerations.md)

This document explains the *billing model* for each service used in this
architecture — not exact prices, which change over time and vary by
region. For a real estimate, use the
[AWS Pricing Calculator](https://calculator.aws/) with your expected
traffic, or consult the current pricing page for each service.

## API Gateway

REST APIs are billed primarily per **million API requests received**,
plus **data transfer out**. There is no charge for an API that receives
no traffic. Caching, if enabled, adds an hourly charge — this project does
not enable caching.

## Lambda

Lambda is billed by **number of invocations** and **execution duration
rounded up, multiplied by allocated memory**. A function that runs for a
few hundred milliseconds at low memory (this project uses 128 MB) costs a
small fraction of a cent per invocation at typical pricing. AWS also
provides a monthly free tier for both invocations and compute duration
that comfortably covers casual use of this project.

## DynamoDB

This table uses **on-demand capacity** (`BillingMode.PAY_PER_REQUEST`),
which bills per **read request unit** and **write request unit**
consumed, plus storage. On-demand mode was chosen over provisioned
capacity because it requires no capacity planning and scales to zero cost
when the table receives no traffic — appropriate for a project that may
sit idle between learning sessions. A steady, predictable, high-volume
production workload might switch to provisioned capacity (optionally with
auto scaling) for a lower cost per request.

`Scan` operations (used by `GET /items`) consume read capacity
proportional to the *entire table's* size, not just the items returned —
this is one of the reasons a growing production table should move away
from `Scan` for its primary listing endpoint. See
[docs/architecture.md](architecture.md) for the reasoning behind using
`Scan` here anyway.

## CloudWatch

CloudWatch bills for **log ingestion volume**, **log storage**, and
**custom metrics**, among other dimensions. This project sets an explicit
one-week log retention period on every Log Group specifically to bound
storage cost — without a retention setting, CloudWatch Logs are kept
indefinitely by default.

## CDK / CloudFormation

CDK and CloudFormation themselves are free to use. `cdk synth` and
`cdk deploy` do not incur AWS charges beyond the cost of the resources
they create — the DynamoDB table, Lambda functions, API Gateway API, IAM
roles, and CloudWatch Log Groups described above. CloudFormation does not
charge for the stack itself, only for the resources it provisions.

## Low-volume example

As an illustrative (not guaranteed) scenario, consider:

```text
1,000 API requests per day
Lambda executions averaging well under a second, at 128 MB memory
Small DynamoDB items (well under 1 KB each)
Log volume limited to a few structured lines per request
```

At this volume, all four services above are likely to fall within, or
very close to, each service's free tier and low-volume pricing tiers, and
the total monthly cost is generally low — often near zero for a single
developer experimenting with the project. This is a general expectation,
not a bill estimate; actual charges depend on your AWS account, region,
and any other resources it contains. Always confirm current pricing with
the AWS Pricing Calculator before relying on a cost estimate.

## Cost optimization

If this project were extended toward production use, the more relevant
cost levers would be:

* **HTTP API instead of REST API** — HTTP APIs are generally cheaper per
  request when the extra REST API features (request validation models,
  usage plans, resource policies) aren't needed.
* **CloudWatch log retention** — already set explicitly here; without a
  retention policy, log storage cost grows unbounded over time.
* **DynamoDB access patterns** — replacing `Scan` with targeted `Query`
  operations (backed by an appropriate key or index) as the table grows,
  since `Scan` cost scales with total table size rather than result size.
* **Avoiding unnecessary scans** — for example, adding filters or
  pagination rather than scanning and returning an entire table on every
  request.
* **Lambda memory/runtime tuning** — Lambda cost scales with allocated
  memory and duration together, so profiling a function and right-sizing
  its memory can reduce cost, though higher memory can sometimes
  *reduce* total cost by finishing faster.
