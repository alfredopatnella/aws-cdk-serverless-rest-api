import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// A single low-level client and document client are created per Lambda
// execution environment (not per invocation) so that connections can be
// reused across warm invocations instead of being re-established every time.
const client = new DynamoDBClient({});

export const ddbDocClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/**
 * Reads the DynamoDB table name from the environment. CDK injects this
 * value at deploy time so handlers never need to hard-code or guess the
 * generated physical table name.
 */
export function getTableName(): string {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return tableName;
}
