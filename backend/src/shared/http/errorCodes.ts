export enum ErrorCode {
  NOT_FOUND = "NOT_FOUND",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  BAD_REQUEST = "BAD_REQUEST",
}

export interface ErrorResponse {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}
