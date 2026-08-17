# Troubleshooting

🌐 Language: **English** | [Español](es/troubleshooting.md)

Practical fixes for the problems most likely to come up while building,
testing, and deploying this project.

## CDK bootstrap error

**Symptom:** `cdk deploy` fails with an error mentioning the environment
has not been bootstrapped, or a missing `CDKToolkit` stack / SSM
parameter.

**Fix:** Every AWS account/region pair needs to be bootstrapped once
before it can host CDK-deployed stacks. Run:

```bash
npx cdk bootstrap
```

This creates a small support stack (an S3 bucket and supporting IAM
roles) that CDK uses to stage deployment assets, such as the bundled
Lambda code produced by `NodejsFunction`. You only need to do this once
per account/region, not before every deploy.

## AWS credentials not configured

**Symptom:** `cdk synth`, `cdk deploy`, or `cdk bootstrap` fail with a
credentials or "Unable to locate credentials" error.

**Fix:** Confirm the CLI can resolve credentials:

```bash
aws sts get-caller-identity
```

If this fails, configure a profile (`aws configure` or
`aws configure sso`, depending on how your organization grants access),
and either export `AWS_PROFILE=<profile-name>` or pass `--profile` to the
`cdk` commands. CDK uses the same credential resolution as the AWS CLI —
whatever `aws sts get-caller-identity` resolves is what CDK will use.

## Lambda cannot access DynamoDB

**Symptom:** API calls return `500 Internal Server Error`, and the
underlying cause is an `AccessDeniedException` from DynamoDB.

**Cause:** Each Lambda in this stack has a narrow IAM policy granting
exactly one DynamoDB action (see `docs/security.md`). If the stack was
modified and a handler now calls a different DynamoDB action than its
policy allows, the call will be denied.

**Fix:** Check the function's CloudWatch Logs (see below) for the exact
`AccessDeniedException` message — it names the missing action and
resource. Update the corresponding `PolicyStatement` in
`lib/serverless-rest-api-stack.ts` to match, then redeploy.

## API returns 500

**Symptom:** A request to any endpoint returns
`{ "error": { "code": "INTERNAL_ERROR", ... } }`.

**Fix:** The handler already logged the real cause to CloudWatch before
returning the generic response. Find the relevant Log Group — each
function has its own, named after its CDK construct ID (for example,
`CreateItemLogGroup`) — and look for an `ERROR`-level structured log line
matching the request's timestamp. Using the AWS CLI:

```bash
aws logs tail /aws/lambda/<function-name> --since 15m --follow
```

(Run `aws lambda list-functions --query "Functions[].FunctionName"` if
you don't already have the exact deployed function name — CDK generates
a suffixed physical name unless one is hard-coded.)

## API returns validation error

**Symptom:** `POST /items` returns `400` with `VALIDATION_ERROR`.

**Fix:** Confirm the request body is valid JSON with a non-empty `title`
string:

```bash
curl -X POST "$API_URL/items" \
  -H "Content-Type: application/json" \
  -d '{"title":"Learn AWS CDK"}'
```

Common mistakes: omitting `-H "Content-Type: application/json"`, sending
`title` as a number or `null`, or sending an empty/whitespace-only
`title`.

## CDK deployment fails

**Symptom:** `cdk deploy` fails partway through, or CloudFormation shows
a `ROLLBACK_COMPLETE` / `UPDATE_ROLLBACK_COMPLETE` stack status.

**Fix:** First confirm the stack still synthesizes cleanly:

```bash
npx cdk synth
```

If synth succeeds but deploy fails, the error is coming from
CloudFormation itself — read the failure reason in the CLI output, or
open the stack's **Events** tab in the CloudFormation console for the
specific resource and reason. If the stack is stuck in
`ROLLBACK_COMPLETE`, it generally needs to be deleted
(`npx cdk destroy`, or delete it in the console) before it can be
deployed again.

## TypeScript build errors

**Symptom:** `npm run build` reports type errors.

**Fix:** Run the build directly to see the full list of errors with file
and line numbers:

```bash
npm run build
```

`tsc` will not emit output while there are type errors under this
project's `strict` compiler settings — fix the reported errors and rerun.

## Tests fail

**Symptom:** `npm test` reports failing assertions.

**Fix:** Run the suite directly and read the failure output — Jest prints
the expected vs. actual value for every failing assertion:

```bash
npm test
```

If a `test/stack.test.ts` assertion fails after a change to
`lib/serverless-rest-api-stack.ts`, it usually means the change altered
one of the architectural properties the test protects (for example, the
DynamoDB key schema, the number of Lambda functions, or an IAM policy's
actions) — confirm the change was intentional before updating the test.

## Destroy fails

**Symptom:** `npx cdk destroy` fails, or CloudFormation shows a
`DELETE_FAILED` status.

**Cause:** This is usually a resource-dependency issue — for example, a
resource CloudFormation didn't create (or that was modified outside of
CloudFormation) blocking deletion of something that depends on it.

**Fix:** Check the specific failure reason in the CLI output or the
CloudFormation console's **Events** tab for the resource that failed to
delete. Retrying `npx cdk destroy` after resolving the blocking issue
(for example, manually removing a resource CloudFormation no longer
tracks) typically completes the deletion. Because this project's
DynamoDB table uses `RemovalPolicy.DESTROY`, the table itself is not a
common cause of delete failures here.
