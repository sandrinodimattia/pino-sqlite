# pino-sqlite

[![npm version](https://badge.fury.io/js/pino-sqlite.svg)](https://badge.fury.io/js/pino-sqlite)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)

A high-performance SQLite transport for Pino, the fast Node.js logger. Persist your application logs to SQLite with automatic buffering, indexing, and transaction safety.

## Features

- 🚀 **High Performance** - Buffered writes with configurable flush intervals
- 📊 **Optimized Indexing** - Automatic creation of indexes for fast queries
- ⚡️ **Lightweight** - Minimal overhead with efficient batch processing
- 📈 **Production Ready** - WAL mode, proper error handling, and graceful shutdown

## Installation

```bash
npm install pino-sqlite better-sqlite3
# or
yarn add pino-sqlite better-sqlite3
# or
pnpm add pino-sqlite better-sqlite3
```

## Quick Start

### Basic Usage

```typescript
import pino from 'pino';

const transport = pino.transport({
  target: 'pino-sqlite',
  level: 'debug',
  options: {
    database: './logs.db',
    serviceName: 'my-app',
  },
});
transport.on('error', (error: Error) => {
  console.error('Error occured in pino-sqlite', error);
});

const logger = pino(transport);
logger.info('Hello, SQLite!');
logger.error({ err }, 'Something went wrong');
```

### Advanced Configuration

```typescript
// Use an existing database instance
const db = new Database('./myapp.db');

const transport = pino.transport({
  target: 'pino-sqlite',
  level: 'debug',
  options: {
    database: db,
    serviceName: 'my-app',
    flushInterval: 500, // Flush every 500ms
    bufferLimit: 100, // Flush when buffer reaches 100 logs
  },
});
```

## API Reference

#### Options

```typescript
interface SQLiteTransportOptions {
  /**
   * Either a filesystem path to the SQLite database file or a better-sqlite3 Database instance.
   * If a path is provided, a new database connection will be created.
   * If a database instance is provided, it will be used directly (the transport will not close it).
   */
  database: string | DatabaseType;

  /**
   * Default service name if log objects don't have one.
   * Useful for identifying logs from different services in a microservices architecture.
   */
  serviceName?: string;

  /**
   * Flush interval in milliseconds.
   * The buffer will be flushed to the database at this interval.
   * Default: 1000ms
   */
  flushInterval?: number;

  /**
   * Buffer size threshold to trigger early flush.
   * If the buffer reaches this size, it will be flushed immediately.
   * Default: 100
   */
  bufferLimit?: number;
}
```

## Database Schema

The transport automatically creates a `logs` table with the following schema:

```sql
CREATE TABLE logs (
  timestamp INTEGER,      -- Unix timestamp in milliseconds
  level INTEGER,          -- Pino log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal)
  hostname TEXT,          -- Hostname from the log entry
  pid INTEGER,            -- Process ID
  service_name TEXT,      -- Service name (from options or log metadata)
  name TEXT,              -- Logger name
  message TEXT,           -- Log message
  meta TEXT               -- JSON stringified metadata
);
```

## Performance Considerations

### Buffering

The transport uses an in-memory buffer to batch log writes, which significantly improves performance:

- **Flush Interval**: Logs are flushed to the database at regular intervals (default: 1 second)
- **Buffer Limit**: If the buffer reaches the limit, it's flushed immediately
- **Batch Inserts**: All logs in a buffer are inserted in a single transaction

### Database Optimization

The transport automatically configures SQLite for optimal performance (only when using a file path, not when providing your own instance):

```typescript
db.pragma('journal_mode = WAL'); // Write-Ahead Logging
db.pragma('synchronous = NORMAL'); // Balanced durability/performance
db.pragma('journal_size_limit = 5242880'); // 5MB journal size limit
db.pragma('cache_size = -10000'); // 10MB cache
db.pragma('busy_timeout = 5000'); // 5 second busy timeout
```

## Error Handling

The transport includes comprehensive error handling:

- **Graceful Degradation**: If database writes fail, errors are logged but don't crash the application
- **Transaction Safety**: Failed writes are rolled back automatically
- **Resource Cleanup**: Database connections are properly closed on transport shutdown

```typescript
// Errors during log processing are handled internally
logger.error('This will be logged even if SQLite is temporarily unavailable');

// Transport shutdown is handled gracefully
process.on('SIGTERM', () => {
  transport.end();
});
```

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Build the project
pnpm build

# Lint the code
pnpm lint

# Format the code
pnpm format
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## Related Projects

- [pino](https://github.com/pinojs/pino) - Fast Node.js logger
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - The fastest and simplest library for SQLite3 in Node.js
- [pino-abstract-transport](https://github.com/pinojs/pino-abstract-transport) - Abstract transport for Pino
