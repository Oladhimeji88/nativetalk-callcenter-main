import { Controller, Get, Header, Injectable, Module, NestMiddleware, MiddlewareConsumer } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import { Public } from '../common/decorators';

// One shared Prometheus registry with Node/process defaults + HTTP metrics.
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'ucp_' });

const httpRequests = new Counter({
  name: 'ucp_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});
const httpDuration = new Histogram({
  name: 'ucp_http_request_duration_seconds',
  help: 'HTTP request duration (seconds)',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 1, 3],
  registers: [registry],
});

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      // Use the route pattern (not the raw URL) to keep label cardinality low.
      const route = (req as any).route?.path ?? req.path?.replace(/\/[0-9a-f]{8,}/gi, '/:id') ?? 'unknown';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      httpRequests.inc(labels);
      end(labels);
    });
    next();
  }
}

@Controller('metrics')
export class MetricsController {
  @Public()
  @Get()
  @Header('Content-Type', registry.contentType)
  metrics() {
    return registry.metrics();
  }
}

@Module({ controllers: [MetricsController] })
export class MetricsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('*');
  }
}
