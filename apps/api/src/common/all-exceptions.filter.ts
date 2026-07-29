import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

// Single place that turns any thrown error into a clean JSON response. Known
// HttpExceptions keep their status/message; anything else becomes a generic 500
// in production (no stack/internal details leaked) but is always logged.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');
  private readonly isProd = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : (body as any).message ?? body;
    } else if (this.isPrismaKnownError(exception)) {
      // Translate common Prisma errors into friendly 4xx responses instead of
      // leaking the raw invocation/stack to the client.
      const e = exception as { code: string; meta?: any };
      status = HttpStatus.BAD_REQUEST;
      if (e.code === 'P2002') {
        const fields = ([] as string[]).concat(e.meta?.target ?? []).filter((f) => f !== 'tenantId');
        message = fields.length
          ? `That ${fields.join(', ')} is already in use. Please choose another.`
          : 'A record with these details already exists.';
      } else if (e.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'The requested record was not found.';
      } else {
        message = 'That action could not be completed.';
      }
    } else if (exception instanceof Error) {
      message = this.isProd ? 'Internal server error' : exception.message;
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status}: ${(exception as Error)?.message}`, (exception as Error)?.stack);
    }

    res.status(status).json({
      statusCode: status,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }

  // Prisma known-request errors carry a string `code` like "P2002".
  private isPrismaKnownError(e: unknown): e is { code: string; meta?: any } {
    return typeof (e as any)?.code === 'string' && /^P\d{4}$/.test((e as any).code);
  }
}
