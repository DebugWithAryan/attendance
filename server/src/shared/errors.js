export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (m, d) => new AppError(400, 'bad_request', m, d);
export const unauthorized = (m = 'Sign in to continue.') => new AppError(401, 'unauthorized', m);
export const forbidden = (m = 'You do not have access to this action.') => new AppError(403, 'forbidden', m);
export const notFound = (m = 'Not found.') => new AppError(404, 'not_found', m);
export const tooManyRequests = (m) => new AppError(429, 'too_many_requests', m);
export const conflict = (m, d) => new AppError(409, 'conflict', m, d);
