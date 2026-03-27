export abstract class AppError extends Error {
  public readonly name: string;
  public readonly isOperational: boolean = true;
  public readonly statusCode: number;

  constructor(
    name: string,
    public readonly safeMessage: string,
    statusCode: number,
    isOperational = true,
    originalError?: Error
  ) {
    super(safeMessage);
    this.name = name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    if (originalError) {
      this.cause = originalError;
    }
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not Found') {
    super('NotFoundError', message, 404, true);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super('BadRequestError', message, 400, true);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation Error') {
    super('ValidationError', message, 400, true);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal Server Error', originalError?: Error) {
    super('InternalServerError', message, 500, false, originalError);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service Unavailable') {
    super('ServiceUnavailableError', message, 503, true);
  }
}

