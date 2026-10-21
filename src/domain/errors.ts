export class AppError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  public constructor(message: string) {
    super(400, 'VALIDATION_ERROR', message);
  }
}

export class NotFoundError extends AppError {
  public constructor(message: string) {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  public constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class ServiceUnavailableError extends AppError {
  public constructor(message: string) {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}
