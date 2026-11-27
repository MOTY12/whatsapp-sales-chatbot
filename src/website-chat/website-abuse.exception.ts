import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

export class WebsiteRateLimitException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      'Too many chat requests. Please wait and try again.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Catch(WebsiteRateLimitException)
export class WebsiteRateLimitFilter implements ExceptionFilter {
  catch(exception: WebsiteRateLimitException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    response.status(exception.getStatus()).json({
      statusCode: exception.getStatus(),
      message: exception.message,
      retryAfterSeconds: exception.retryAfterSeconds,
    });
  }
}
