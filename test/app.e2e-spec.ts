import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Vehicle Marketplace API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Check', () => {
    it('/health (GET) should return healthy status', () => {
      return request(app.getHttpServer()).get('/api/v1/health').expect(200);
    });
  });

  describe('Auth Flow', () => {
    let accessToken: string;
    const testPhone = '+201099999999';

    it('/auth/register (POST) should register a new user', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ phone: testPhone, firstName: 'Test', lastName: 'User' })
        .expect(201)
        .then((res) => {
          expect(res.body.data.message).toContain('Registration successful');
          expect(res.body.data.userId).toBeDefined();
        });
    });

    it('/auth/register (POST) should reject duplicate phone', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ phone: testPhone })
        .expect(409);
    });

    it('/auth/verify-otp (POST) should reject invalid OTP', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ phone: testPhone, code: '000000' })
        .expect(400);
    });
  });

  describe('Vehicles (Public)', () => {
    it('/vehicles (GET) should return paginated vehicles', () => {
      return request(app.getHttpServer())
        .get('/api/v1/vehicles')
        .expect(200)
        .then((res) => {
          expect(res.body.data.items).toBeDefined();
          expect(res.body.data.meta).toBeDefined();
        });
    });
  });

  describe('Auctions (Public)', () => {
    it('/auctions (GET) should return auctions', () => {
      return request(app.getHttpServer())
        .get('/api/v1/auctions')
        .expect(200)
        .then((res) => {
          expect(res.body.data.items).toBeDefined();
        });
    });
  });

  describe('Protected Routes', () => {
    it('should reject unauthenticated requests', () => {
      return request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    });

    it('should reject requests to admin routes', () => {
      return request(app.getHttpServer()).get('/api/v1/admin/dashboard').expect(401);
    });
  });
});
