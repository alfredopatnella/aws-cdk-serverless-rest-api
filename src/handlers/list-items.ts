import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient, getTableName } from '../shared/dynamodb';
import { internalError, success } from '../shared/responses';

// A full table Scan is acceptable here because this is a small educational
// example with no pagination requirements. A production workload with a
// large or growing table should replace this with a Query against a
// well-chosen key or index, plus pagination, instead of scanning every item.
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log(
    JSON.stringify({
      level: 'INFO',
      message: 'Listing items',
      requestId: event.requestContext.requestId,
    })
  );

  try {
    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: getTableName(),
      })
    );

    return success(200, result.Items ?? []);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Failed to scan items from DynamoDB',
        requestId: event.requestContext.requestId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    );
    return internalError();
  }
};
