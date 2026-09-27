import { badRequest } from './errors.js';

// One place where Zod issues become API errors, so route handlers stay clean.
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('Check the highlighted fields.', result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    })));
  }
  return result.data;
}
