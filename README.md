# AttendEase Server

Express.js backend for the AttendEase Attendance ERP system.

## Tech Stack

- **Node.js** with Express 5
- **TypeScript** (strict mode)
- **MongoDB** with Mongoose
- **JWT** authentication

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev
```

Server runs at [http://localhost:5000](http://localhost:5000)

## API Endpoints

### Health Check
```
GET /api/health
```

Returns server status and uptime.

## Folder Structure

```
src/
├── config/        # Configuration and database
├── controllers/   # Route handlers
├── middleware/    # Express middleware
├── models/        # Mongoose schemas
├── routes/        # API route definitions
├── services/      # Business logic
├── types/         # TypeScript interfaces
└── utils/         # Helper utilities
```

## Available Scripts

- `npm run dev` - Start with hot reload
- `npm run build` - Compile TypeScript
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors
- `npm run format` - Format with Prettier
- `npm run type-check` - TypeScript type checking

## Authentication

JWT-based authentication is set up with:
- `authenticate` middleware for protected routes
- `authorize` middleware for role-based access

Example usage:
```typescript
import { authenticate, authorize } from './middleware/auth';

router.get('/admin', authenticate, authorize('admin'), adminController);
```

## Error Handling

Centralized error handling with custom error classes:

```typescript
import { BadRequestError, NotFoundError } from './utils/AppError';

throw new BadRequestError('Invalid input');
throw new NotFoundError('Resource not found');
```

## Environment Variables

See `.env.example` for required configuration.
