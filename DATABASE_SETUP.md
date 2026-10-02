# Database Setup Guide

This project uses **TypeORM** with **PostgreSQL** for data persistence.

## Prerequisites

- PostgreSQL 12+ installed and running
- Node.js 18+

## Setup Steps

### 1. Install Dependencies
Dependencies are already installed via npm install. If not:
```bash
npm install @nestjs/typeorm typeorm pg
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and update the database connection details:
```bash
cp .env.example .env
```

Edit `.env` with your PostgreSQL credentials:
```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
DATABASE_NAME=kleva_db
```

### 3. Create PostgreSQL Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE kleva_db;

# Exit psql
\q
```

Or using createdb command:
```bash
createdb -U postgres kleva_db
```

### 4. Auto-Sync Schema (Development Only)

In development mode (`NODE_ENV=development`), TypeORM automatically creates/updates tables on startup.

Just run:
```bash
npm run start:dev
```

The application will:
1. Connect to PostgreSQL
2. Create all tables defined in entities
3. Start the server on port 3000

### 5. Verify Database Connection

If the application starts without errors, your database is connected.

Check the database:
```bash
psql -U postgres -d kleva_db -c "\dt"
```

You should see tables:
- businesses
- users
- customers
- conversations
- messages
- pipeline_stages
- follow_ups
- tasks
- audit_logs
- notifications

## Database Structure

### Core Entities

| Entity | Purpose |
|--------|---------|
| Business | Businesses using Kleva |
| User | Business owners/team members |
| Customer | Leads and customers |
| Conversation | Chat sessions with customers |
| Message | Individual messages in conversations |
| PipelineStage | Sales pipeline stages |
| FollowUp | Reminders and follow-ups |
| Task | Business tasks |
| AuditLog | Audit trail of actions |
| Notification | System notifications |

## Repositories

Query data using repository services:
- `BusinessRepository` - Business queries
- `CustomerRepository` - Customer queries
- `FollowUpRepository` - Follow-up queries

### Example Usage

```typescript
import { CustomerRepository } from './database/repositories';

export class MyService {
  constructor(private customerRepo: CustomerRepository) {}

  async getCustomer(businessId: string, customerId: string) {
    return this.customerRepo.findById(customerId);
  }

  async getAllCustomers(businessId: string) {
    return this.customerRepo.findByBusinessId(businessId);
  }

  async updateCustomer(customerId: string, name: string) {
    return this.customerRepo.update(customerId, { name });
  }
}
```

## Running Migrations (Production)

For production, disable auto-sync and run TypeORM migrations:

```bash
# Generate migration files
npm run typeorm migration:generate -- src/migrations/InitialSchema

# Run migrations
npm run typeorm migration:run

# Revert last migration if needed
npm run typeorm migration:revert
```

## Adding New Entities

1. Create entity file in `src/database/entities/`
2. Add entity to the `entities` array in `database.module.ts`
3. Create corresponding repository if needed
4. Export from `src/database/index.ts`
5. Use repository in your services

## Troubleshooting

### Connection Refused
- Ensure PostgreSQL is running: `sudo service postgresql status`
- Check DATABASE_HOST, PORT, USER, PASSWORD in .env
- Create database if missing: `createdb -U postgres kleva_db`

### Relations Not Loading
- Use `relations: ['field']` in repository methods
- Ensure foreign keys are properly defined in entities

### TypeORM Logging
Enable detailed logging in .env:
```env
DATABASE_LOGGING=true
```

## References

- [TypeORM Documentation](https://typeorm.io/)
- [NestJS Database Integration](https://docs.nestjs.com/techniques/database)
