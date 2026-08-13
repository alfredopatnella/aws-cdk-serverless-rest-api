import { internalError, notFoundError, success, validationError } from '../../src/shared/responses';

describe('response helpers', () => {
  it('builds a successful response with a JSON content type and body', () => {
    const result = success(201, { id: '123' });
    expect(result.statusCode).toBe(201);
    expect(result.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(result.body)).toEqual({ id: '123' });
  });

  it('builds a successful response with no body', () => {
    const result = success(204);
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
  });

  it('builds a structured validation error response', () => {
    const result = validationError('title is required');
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'title is required' },
    });
  });

  it('builds a structured not-found error response', () => {
    const result = notFoundError('Item was not found');
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({
      error: { code: 'NOT_FOUND', message: 'Item was not found' },
    });
  });

  it('builds a structured internal error response without leaking details', () => {
    const result = internalError();
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });
});
