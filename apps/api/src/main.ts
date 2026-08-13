import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertProductionSecrets } from './common/config/secrets-guard';

async function bootstrap() {
  // 개발용 기본 시크릿이 운영에 올라가면 여기서 기동이 멈춘다(모듈 로드 전에 확인)
  assertProductionSecrets();

  const app = await NestFactory.create(AppModule);

  const expressApp = app.getHttpAdapter().getInstance();
  if (
    process.env.TRUST_PROXY === '1' ||
    process.env.TRUST_PROXY === 'true'
  ) {
    expressApp.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');

  // Reflect request Origin so login works when users open the app via localhost, 127.0.0.1, or LAN IP
  // (PUBLIC_URL alone cannot list every browser URL). JWT is sent in Authorization, not cookies.
  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Policy Manager API')
    .setDescription('Policy management system API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log('Application is running on port ' + port);
}
bootstrap();