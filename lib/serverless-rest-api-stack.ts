import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  AuthorizationType,
  JsonSchemaType,
  LambdaIntegration,
  LogGroupLogDestination,
  RequestValidator,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

const HANDLERS_DIR = path.join(__dirname, '..', 'src', 'handlers');

export class ServerlessRestApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Data layer -------------------------------------------------------
    //
    // "id" is the partition key: the single value DynamoDB hashes to decide
    // which internal storage partition an item lives on, and the only key
    // GetItem/DeleteItem need to read or remove a single item in O(1) time.
    // RemovalPolicy.DESTROY lets `cdk destroy` delete this table along with
    // the rest of the stack, which is appropriate for a disposable
    // educational project but would normally be RemovalPolicy.RETAIN (plus
    // point-in-time recovery) for a production data store.
    const table = new Table(this, 'ItemsTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Lambda functions ---------------------------------------------------
    //
    // One Lambda per operation keeps the routing and the IAM permissions for
    // each operation visually obvious: every function's handler file and its
    // permission grant sit next to each other below.
    const commonProps = {
      runtime: Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
    };

    const makeLogGroup = (id: string) =>
      new LogGroup(this, id, {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const createItemFn = new NodejsFunction(this, 'CreateItemFunction', {
      ...commonProps,
      entry: path.join(HANDLERS_DIR, 'create-item.ts'),
      handler: 'handler',
      logGroup: makeLogGroup('CreateItemLogGroup'),
    });

    const listItemsFn = new NodejsFunction(this, 'ListItemsFunction', {
      ...commonProps,
      entry: path.join(HANDLERS_DIR, 'list-items.ts'),
      handler: 'handler',
      logGroup: makeLogGroup('ListItemsLogGroup'),
    });

    const getItemFn = new NodejsFunction(this, 'GetItemFunction', {
      ...commonProps,
      entry: path.join(HANDLERS_DIR, 'get-item.ts'),
      handler: 'handler',
      logGroup: makeLogGroup('GetItemLogGroup'),
    });

    const deleteItemFn = new NodejsFunction(this, 'DeleteItemFunction', {
      ...commonProps,
      entry: path.join(HANDLERS_DIR, 'delete-item.ts'),
      handler: 'handler',
      logGroup: makeLogGroup('DeleteItemLogGroup'),
    });

    // --- Least-privilege IAM ------------------------------------------------
    //
    // Each function receives only the single DynamoDB action it performs,
    // scoped to this one table, instead of a broad grant such as
    // table.grantReadWriteData() or "dynamodb:*". A learner can read this
    // block and know exactly what each Lambda is authorized to do.
    createItemFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [table.tableArn],
      })
    );

    listItemsFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:Scan'],
        resources: [table.tableArn],
      })
    );

    getItemFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [table.tableArn],
      })
    );

    deleteItemFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:DeleteItem'],
        resources: [table.tableArn],
      })
    );

    // --- API Gateway ---------------------------------------------------------
    const apiLogGroup = new LogGroup(this, 'ApiAccessLogGroup', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const api = new RestApi(this, 'ItemsApi', {
      restApiName: 'Serverless Task API',
      description: 'Reference REST API backed by Lambda and DynamoDB.',
      deployOptions: {
        stageName: 'prod',
        accessLogDestination: new LogGroupLogDestination(apiLogGroup),
      },
      // No authorizer is configured: this is an intentionally unauthenticated
      // educational example. See docs/security.md for production options.
      defaultMethodOptions: {
        authorizationType: AuthorizationType.NONE,
      },
    });

    // JSON Schema model used for API Gateway request validation on POST
    // /items. This is a defense-in-depth demonstration: rejecting obviously
    // malformed requests here saves a Lambda invocation, but the Lambda
    // still validates independently because it cannot assume every caller
    // reaches it through this API Gateway configuration.
    const createItemModel = api.addModel('CreateItemModel', {
      contentType: 'application/json',
      schema: {
        type: JsonSchemaType.OBJECT,
        required: ['title'],
        properties: {
          title: { type: JsonSchemaType.STRING, minLength: 1 },
        },
      },
    });

    const requestValidator = new RequestValidator(this, 'CreateItemRequestValidator', {
      restApi: api,
      validateRequestBody: true,
    });

    const items = api.root.addResource('items');
    items.addMethod('POST', new LambdaIntegration(createItemFn), {
      requestValidator,
      requestModels: { 'application/json': createItemModel },
    });
    items.addMethod('GET', new LambdaIntegration(listItemsFn));

    const item = items.addResource('{id}');
    item.addMethod('GET', new LambdaIntegration(getItemFn));
    item.addMethod('DELETE', new LambdaIntegration(deleteItemFn));

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Base URL of the deployed Task API',
    });
  }
}
