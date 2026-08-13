import { CreateItemRequest } from '../types/item';

export const MAX_TITLE_LENGTH = 200;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: CreateItemRequest;
}

/**
 * Validates the raw POST /items request body.
 *
 * This runs inside the Lambda even though API Gateway can also perform
 * basic request validation, because the Lambda is the last line of
 * defense: it cannot assume every caller went through API Gateway with
 * validation enabled, and it must never trust client input by default.
 */
export function validateCreateItemBody(rawBody: string | null): ValidationResult {
  if (!rawBody) {
    return { valid: false, errors: ['Request body is required'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { valid: false, errors: ['Request body must be valid JSON'] };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const errors: string[] = [];
  const { title } = parsed as Record<string, unknown>;

  if (title === undefined) {
    errors.push('title is required');
  } else if (typeof title !== 'string') {
    errors.push('title must be a string');
  } else if (title.trim().length === 0) {
    errors.push('title cannot be blank');
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push(`title cannot exceed ${MAX_TITLE_LENGTH} characters`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], data: { title: (title as string).trim() } };
}
