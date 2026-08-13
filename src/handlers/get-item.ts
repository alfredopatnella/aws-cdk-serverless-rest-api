import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient, getTableName } from '../shared/dynamodb';
import { internalError, notFoundError, success, validationError } from '../shared/responses';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const id = event.pathParameters?.id;
  console.log(
    JSON.stringify({
      level: 'INFO',
      message: 'Getting item',
      requestId: event.requestContext.requestId,
      itemId: id,
    })
  );

  if (!id) {
    return validationError('id path parameter is required');
  }

  try {
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: getTableName(),
        Key: { id },
      })
    );

    if (!result.Item) {
      return notFoundError('Item was not found');
    }

    return success(200, result.Item);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Failed to get item from DynamoDB',
        requestId: event.requestContext.requestId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    );
    return internalError();
  }
};
