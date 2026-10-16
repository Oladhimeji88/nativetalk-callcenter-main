import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  // Fail fast in production if the JWT secret wasn't changed from the dev default.
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'dev-secret') {
      throw new Error('JWT_SECRET must be set to a strong value in production');
    }
  }

  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(cookieParser());

  // CORS: must allow credentials so the browser sends the auth cookie.
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3001').split(',').map((s) => s.trim());
  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`NativeTalk API listening on http://localhost:${port} (cors: ${origins.join(', ')})`);
}
bootstrap();
