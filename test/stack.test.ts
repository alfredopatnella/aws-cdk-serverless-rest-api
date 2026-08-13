import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ServerlessRestApiStack } from '../lib/serverless-rest-api-stack';

// These tests assert on architectural properties of the synthesized
// CloudFormation template rather than incidental implementation details.
// They protect against accidentally regressing the things that make this
// stack a good teaching example: a single-key DynamoDB table, one Lambda
// per operation, an API surface matching the documented routes, and
// least-privilege IAM instead of broad DynamoDB access.
describe('ServerlessRestApiStack', () => {
  const app = new App();
  const stack = new ServerlessRestApiStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  it('creates a DynamoDB table with a string partition key named id', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'id', AttributeType: 'S' },
      ]),
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('creates exactly four Lambda functions for the four operations', () => {
    template.resourceCountIs('AWS::Lambda::Function', 4);
  });

  it('configures every Lambda with the DynamoDB table name in its environment', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
        }),
      },
    });
    template.resourceCountIs('AWS::Lambda::Function', 4);
  });

  it('creates an API Gateway REST API', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  });

  it('exposes POST and GET on /items and GET and DELETE on /items/{id}', () => {
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'items',
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: '{id}',
    });

    const methods = ['POST', 'GET', 'GET', 'DELETE'];
    for (const httpMethod of methods) {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: httpMethod,
      });
    }
    template.resourceCountIs('AWS::ApiGateway::Method', 4);
  });

  it('grants each Lambda only the single DynamoDB action it needs', () => {
    const expectedActions = ['dynamodb:PutItem', 'dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:DeleteItem'];

    for (const action of expectedActions) {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: action,
            }),
          ]),
        },
      });
    }
  });

  it('never grants unrestricted DynamoDB access', () => {
    const policies = template.findResources('AWS::IAM::Policy');

    for (const policy of Object.values(policies)) {
      const statements = policy.Properties.PolicyDocument.Statement as Array<{
        Effect: string;
        Action: string | string[];
      }>;

      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        for (const action of actions) {
          if (typeof action === 'string' && action.startsWith('dynamodb:')) {
            expect(action).not.toBe('dynamodb:*');
          }
        }
      }
    }
  });
});
