import build from 'pino-abstract-transport';
import Database, { Database as DatabaseType } from 'better-sqlite3';

interface LogObject {
  /**
   * Numeric log level (e.g., 10, 20, ... 50).
   */
  level: number;

  /**
   * Timestamp in milliseconds since Unix epoch (Pino uses 'time').
   */
  time: number;

  /**
   * The log message.
   */
  msg: string;

  /**
   * Process ID (from Pino).
   */
  pid?: number;

  /**
   * Any other metadata fields.
   */
  [key: string]: unknown;
}

interface SQLiteTransportOptions {
  /**
   * Either a filesystem path to the SQLite database file or a better-sqlite3 Database instance.
   * If a path is provided, a new database connection will be created.
   * If a database instance is provided, it will be used directly (the transport will not close it).
   */
  database: string | DatabaseType;

  /**
   * Default service name if log objects don't have one.
   */
  serviceName?: string;

  /**
   * Flush interval in milliseconds.
   * Eg: If flushInterval is 1000, the buffer will be flushed every 1000ms.
   */
  flushInterval?: number;

  /**
   * Buffer size threshold to trigger early flush.
   * Eg: If bufferLimit is 100, and the buffer has 100 logs, the buffer will be flushed.
   */
  bufferLimit?: number;
}

/**
 * Log an error to the console.
 * @param message - The error message.
 * @param error - The error object.
 */
function logError(message: string, error: Error): void {
  if (process._rawDebug) {
    process._rawDebug(`Error in pino-sqlite: ${message}`, {
      message: error.message,
      name: error.name,
      stack: error.stack,
    });
  }
}

/**
 * Handle uncaught exceptions.
 */
process.on('uncaughtException', (error) => {
  logError('Uncaught exception', error);
  process.exit(1);
});

/**
 * Handle unhandled rejections.
 */
process.on('unhandledRejection', (error) => {
  logError('Unhandled rejection', error as Error);
  process.exit(1);
});

/**
 * Create a new SQLite transport for Pino which writes logs to a SQLite database.
 * @param opts - The transport options.
 * @returns The transport function.
 */
export default function sqliteTransport(opts: SQLiteTransportOptions): ReturnType<typeof build> {
  const { database, serviceName = undefined, flushInterval = 1000, bufferLimit = 100 } = opts;

  // Handle database initialization
  let db: DatabaseType;
  let shouldCloseDatabase = false;

  if (typeof database === 'string') {
    // Create a new database connection from the path
    db = new Database(database);
    shouldCloseDatabase = true;

    // Configure database pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('journal_size_limit = 5242880');
    db.pragma('cache_size = -10000');
    db.pragma('busy_timeout = 5000');
  } else {
    // Use the provided database instance
    db = database;
    shouldCloseDatabase = false;
  }

  // Create table and indexes if they don't exist.
  db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        timestamp INTEGER,
        level INTEGER,
        hostname TEXT,
        pid INTEGER,
        service_name TEXT,
        name TEXT,
        message TEXT,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_name ON logs(name);
      CREATE INDEX IF NOT EXISTS idx_logs_hostname ON logs(hostname);
      CREATE INDEX IF NOT EXISTS idx_logs_service_name ON logs(service_name, name);
      CREATE INDEX IF NOT EXISTS idx_logs_service_name_level_time ON logs(service_name, name, level, timestamp);
      `);

  // Batch insert logs into the database.
  const insertStmt = db.prepare(
    `INSERT INTO logs (timestamp, level, hostname, pid, service_name, name, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertBatch = db.transaction((logs: LogObject[]) => {
    for (const log of logs) {
      const { time, level, pid, name, msg, hostname, ...rest } = log;
      const timestamp = time || Date.now();
      const metaJson = JSON.stringify(rest);
      insertStmt.run(timestamp, level, hostname, pid, serviceName, name, msg, metaJson);
    }
  });

  // In-memory buffer for logs awaiting insertion
  const buffer: LogObject[] = [];
  let flushing = false;
  let flushTimer: NodeJS.Timeout | null = null;

  /**
   * Flush function to write buffered logs to DB.
   */
  const flushBuffer = (): void => {
    // Skip if a flush is already in progress.
    if (flushing) {
      return;
    }

    // Skip if there are no logs to flush.
    if (buffer.length === 0) {
      return;
    }

    // Set the flushing flag to avoid concurrent flushes.
    flushing = true;

    try {
      // Insert all buffered logs in a single transaction batch for efficiency.
      insertBatch(buffer);
      buffer.length = 0;
    } catch (e) {
      logError('Flushing logs failed', e as Error);
    } finally {
      flushing = false;
    }
  };

  // Set up periodic flushing at the configured interval to ensure timely writes.
  flushTimer = setInterval(flushBuffer, flushInterval);

  // Return the transport function.
  return build(
    async function (source) {
      for await (const obj of source) {
        const log = obj as LogObject;
        buffer.push(log);

        // If buffer exceeds the threshold, flush immediately to avoid growing too large
        if (buffer.length >= bufferLimit) {
          flushBuffer();
        }
      }
    },
    {
      async close(err?: Error) {
        try {
          // If there was an error, reject the promise.
          if (err) {
            throw err;
          }

          // Clear the flush timer.
          if (flushTimer) {
            clearInterval(flushTimer);
            flushTimer = null;
          }

          // Flush any remaining logs synchronously.
          flushBuffer();

          // Close the database connection
          if (shouldCloseDatabase) {
            db.close();
          }
        } catch (e) {
          logError('Transport close failed', e as Error);
        }
      },
    }
  );
}
