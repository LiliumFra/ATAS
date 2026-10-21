import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../domain/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation !== undefined) {
      request.log.warn({ err: error }, 'Request validation failed');
      void reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof AppError) {
      request.log.warn({ err: error }, 'Request rejected');
      void reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    const databaseCode = (error as { code?: unknown }).code;
    if (databaseCode === '23505') {
      request.log.warn({ err: error }, 'Database conflict');
      void reply.code(409).send({
        error: 'CONFLICT',
        message: 'The operation conflicts with the current resource state',
        requestId: request.id,
      });
      return;
    }
    if (databaseCode === '23503' || databaseCode === '23514' || databaseCode === '22P02') {
      request.log.warn({ err: error }, 'Database rejected invalid input');
      void reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'The submitted data violates a system constraint',
        requestId: request.id,
      });
      return;
    }

    request.log.error({ err: error }, 'Request failed');
    void reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'The request could not be completed',
      requestId: request.id,
    });
  });
}
