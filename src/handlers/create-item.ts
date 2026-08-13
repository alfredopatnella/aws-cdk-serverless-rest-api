import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { ddbDocClient, getTableName } from '../shared/dynamodb';
import { internalError, success, validationError } from '../shared/responses';
import { validateCreateItemBody } from '../shared/validation';
import { Item } from '../types/item';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log(
    JSON.stringify({
      level: 'INFO',
      message: 'Creating item',
      requestId: event.requestContext.requestId,
    })
  );

  const result = validateCreateItemBody(event.body);
  if (!result.valid || !result.data) {
    return validationError(result.errors.join(', '));
  }

  const item: Item = {
    id: randomUUID(),
    title: result.data.title,
    completed: false,
    createdAt: new Date().toISOString(),
  };

  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Failed to write item to DynamoDB',
        requestId: event.requestContext.requestId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    );
    return internalError();
  }

  return success(201, item);
};
