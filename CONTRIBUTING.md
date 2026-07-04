# Contributing

Thank you for your interest in contributing to Vehicle Marketplace API!

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Start services: `docker-compose up -d postgres redis minio createbucket`
4. Copy environment: `cp .env.example .env`
5. Run migrations: `npm run prisma:migrate`
6. Start dev server: `npm run start:dev`

## Code Style

- We use ESLint + Prettier for consistent formatting
- Run `npm run lint` before committing
- Husky pre-commit hooks will auto-format staged files

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add vehicle image upload endpoint
fix: resolve race condition in auction bidding
docs: update API documentation
test: add unit tests for wallet service
chore: update dependencies
refactor: extract pagination logic to shared DTO
```

## Pull Request Process

1. Create a feature branch from `main`
2. Write tests for new functionality
3. Ensure all tests pass: `npm run test`
4. Update documentation if needed
5. Submit PR with a clear description

## Module Structure

Each module follows this pattern:

```
src/modules/{module}/
├── {module}.module.ts     # Module definition
├── {module}.service.ts    # Business logic
├── {module}.controller.ts # HTTP handlers
├── {module}.gateway.ts    # WebSocket (if applicable)
├── dto/                   # Request/Response DTOs
└── {module}.service.spec.ts # Tests
```

## Testing

- Unit tests: Test service methods in isolation
- Integration tests: Test critical flows end-to-end
- Target coverage: >70%

## Questions?

Open an issue for any questions or discussion.
