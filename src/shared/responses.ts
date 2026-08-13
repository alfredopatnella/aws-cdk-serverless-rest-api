import { APIGatewayProxyResult } from 'aws-lambda';

export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
};

/** Builds a successful JSON API Gateway response with a consistent shape. */
export function success<T>(statusCode: number, body?: T): APIGatewayProxyResult {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

/**
 * Builds a structured error response. Clients always receive the same
 * `{ error: { code, message } }` shape regardless of what failed, so raw
 * AWS SDK errors and stack traces are never leaked to callers.
 */
export function error(statusCode: number, code: ErrorCode, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: { code, message } }),
  };
}

export const validationError = (message: string): APIGatewayProxyResult =>
  error(400, 'VALIDATION_ERROR', message);

export const notFoundError = (message: string): APIGatewayProxyResult =>
  error(404, 'NOT_FOUND', message);

export const internalError = (): APIGatewayProxyResult =>
  error(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
