import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient, getTableName } from '../shared/dynamodb';
import { internalError, notFoundError, success, validationError } from '../shared/responses';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const id = event.pathParameters?.id;
  console.log(
    JSON.stringify({
      level: 'INFO',
      message: 'Deleting item',
      requestId: event.requestContext.requestId,
      itemId: id,
    })
  );

  if (!id) {
    return validationError('id path parameter is required');
  }

  try {
    // A condition expression makes DeleteItem fail when the item does not
    // exist, so the handler can return 404 instead of silently succeeding
    // on a no-op delete. DynamoDB DeleteItem otherwise always reports
    // success even when nothing matched the key.
    await ddbDocClient.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );

    return success(204);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return notFoundError('Item was not found');
    }

    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Failed to delete item from DynamoDB',
        requestId: event.requestContext.requestId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    );
    return internalError();
  }
};
