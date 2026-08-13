import { validateCreateItemBody, MAX_TITLE_LENGTH } from '../../src/shared/validation';

describe('validateCreateItemBody', () => {
  it('rejects a missing body', () => {
    const result = validateCreateItemBody(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Request body is required');
  });

  it('rejects malformed JSON', () => {
    const result = validateCreateItemBody('{ title: not valid json');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Request body must be valid JSON');
  });

  it('rejects a body missing title', () => {
    const result = validateCreateItemBody(JSON.stringify({}));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('title is required');
  });

  it('rejects a blank title', () => {
    const result = validateCreateItemBody(JSON.stringify({ title: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('title cannot be blank');
  });

  it('rejects a non-string title', () => {
    const result = validateCreateItemBody(JSON.stringify({ title: 123 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('title must be a string');
  });

  it('rejects a title longer than the maximum length', () => {
    const result = validateCreateItemBody(JSON.stringify({ title: 'a'.repeat(MAX_TITLE_LENGTH + 1) }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('cannot exceed');
  });

  it('accepts a valid title', () => {
    const result = validateCreateItemBody(JSON.stringify({ title: 'Learn AWS CDK' }));
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ title: 'Learn AWS CDK' });
  });
});
