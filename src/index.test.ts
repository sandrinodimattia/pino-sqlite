import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import pino from 'pino';
import sqliteTransport from './index';

interface LogRecord {
  timestamp: number;
  level: number;
  hostname: string | null;
  pid: number | null;
  service_name: string | null;
  name: string | null;
  message: string;
  meta: string;
}

describe('pino-sqlite transport', () => {
  let testDb: DatabaseType;

  beforeEach(() => {
    testDb = new Database(':memory:');
  });

  afterEach(async () => {
    testDb.close();
  });

  describe('basic functionality', () => {
    it('should create transport with default options', async () => {
      const transport = sqliteTransport({ database: testDb });
      const logger = pino(transport);
      expect(logger).toBeDefined();
    });

    it('should create transport with custom options', async () => {
      const transport = sqliteTransport({
        database: testDb,
        serviceName: 'test-service',
        flushInterval: 500,
        bufferLimit: 50,
      });

      const logger = pino(transport);
      expect(logger).toBeDefined();
    });

    it('should create logs table with proper schema', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(transport);
      logger.info('Test message');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      // Check if table exists
      const tableExists = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='logs'")
        .get();
      expect(tableExists).toBeDefined();

      // Check table schema
      const schema = testDb.prepare('PRAGMA table_info(logs)').all() as Array<{ name: string }>;
      const columns = schema.map((col) => col.name);
      expect(columns).toContain('timestamp');
      expect(columns).toContain('level');
      expect(columns).toContain('hostname');
      expect(columns).toContain('pid');
      expect(columns).toContain('service_name');
      expect(columns).toContain('name');
      expect(columns).toContain('message');
      expect(columns).toContain('meta');
    });

    it('should create required indexes', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(transport);
      logger.info('Test message');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const indexes = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='logs'")
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((idx) => idx.name);
      expect(indexNames).toContain('idx_logs_timestamp');
      expect(indexNames).toContain('idx_logs_level');
      expect(indexNames).toContain('idx_logs_name');
      expect(indexNames).toContain('idx_logs_hostname');
      expect(indexNames).toContain('idx_logs_service_name');
      expect(indexNames).toContain('idx_logs_service_name_level_time');
    });
  });

  describe('log processing', () => {
    it('should process and store logs correctly', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(transport);
      logger.info('Test info message');
      logger.error('Test error message');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      // Check if logs were stored
      const storedLogs = testDb
        .prepare('SELECT * FROM logs ORDER BY timestamp')
        .all() as LogRecord[];
      expect(storedLogs).toHaveLength(2);
      expect(storedLogs[0].level).toBe(30);
      expect(storedLogs[0].message).toBe('Test info message');
      expect(storedLogs[1].level).toBe(50);
      expect(storedLogs[1].message).toBe('Test error message');
    });

    it('should handle logs with custom fields', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(transport);
      logger.info({ userId: 123, requestId: 'req-456' }, 'Log with custom fields');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLog = testDb.prepare('SELECT * FROM logs').get() as LogRecord;
      expect(storedLog).toBeDefined();
      expect(storedLog.message).toBe('Log with custom fields');
      const parsedMeta = JSON.parse(storedLog.meta);
      expect(parsedMeta.userId).toBe(123);
      expect(parsedMeta.requestId).toBe('req-456');
    });

    it('should use service name from options', async () => {
      const serviceName = 'my-service';
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
        serviceName,
      });

      const logger = pino(transport);
      logger.info('Service log message');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLog = testDb.prepare('SELECT * FROM logs').get() as LogRecord;
      expect(storedLog.service_name).toBe(serviceName);
    });

    it('should store metadata as JSON in meta field', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(transport);

      const metadata = {
        userId: 123,
        requestId: 'req-456',
        tags: ['api', 'v1'],
        nested: { key: 'value' },
      };

      logger.info(metadata, 'Log with metadata');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLog = testDb.prepare('SELECT * FROM logs').get() as LogRecord;
      const parsedMeta = JSON.parse(storedLog.meta);
      expect(parsedMeta.userId).toBe(123);
      expect(parsedMeta.requestId).toBe('req-456');
      expect(parsedMeta.tags).toEqual(['api', 'v1']);
      expect(parsedMeta.nested).toEqual({ key: 'value' });
    });
  });

  describe('buffering and flushing', () => {
    it('should flush buffer when limit is reached', async () => {
      const bufferLimit = 3;
      const transport = sqliteTransport({
        database: testDb,
        bufferLimit,
        flushInterval: 50,
      });

      const logger = pino(transport);
      logger.info('Log 1');
      logger.info('Log 2');
      logger.info('Log 3');
      logger.info('Log 4');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLogs = testDb.prepare('SELECT * FROM logs').all() as LogRecord[];
      expect(storedLogs).toHaveLength(4);
    });

    it('should flush buffer on interval', async () => {
      const flushInterval = 100;
      const transport = sqliteTransport({
        database: testDb,
        flushInterval,
      });

      const logger = pino(transport);
      logger.info('Delayed flush test');

      // Wait for the flush interval
      await new Promise((resolve) => setTimeout(resolve, flushInterval + 50));

      const storedLogs = testDb.prepare('SELECT * FROM logs').all() as LogRecord[];
      expect(storedLogs).toHaveLength(1);
      expect(storedLogs[0].message).toBe('Delayed flush test');

      // Close the transport
      logger.flush();
      transport.end();
    });
  });

  describe('log levels', () => {
    it('should handle different log levels correctly', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(
        {
          level: 'trace',
        },
        transport
      );
      logger.trace('Trace message');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');
      logger.fatal('Fatal message');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLogs = testDb.prepare('SELECT * FROM logs ORDER BY level').all() as LogRecord[];
      expect(storedLogs).toHaveLength(6);
      expect(storedLogs[0].level).toBe(10); // trace
      expect(storedLogs[1].level).toBe(20); // debug
      expect(storedLogs[2].level).toBe(30); // info
      expect(storedLogs[3].level).toBe(40); // warn
      expect(storedLogs[4].level).toBe(50); // error
      expect(storedLogs[5].level).toBe(60); // fatal
    });

    it('should respect log level filtering', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(
        {
          level: 'warn',
        },
        transport
      );
      logger.debug('Debug message - should not be logged');
      logger.info('Info message - should not be logged');
      logger.warn('Warn message - should be logged');
      logger.error('Error message - should be logged');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLogs = testDb.prepare('SELECT * FROM logs').all() as LogRecord[];
      expect(storedLogs).toHaveLength(2);

      const messages = storedLogs.map((log) => log.message);
      expect(messages).toContain('Warn message - should be logged');
      expect(messages).toContain('Error message - should be logged');
      expect(messages).not.toContain('Debug message - should not be logged');
      expect(messages).not.toContain('Info message - should not be logged');
    });
  });

  describe('performance and concurrency', () => {
    it('should handle multiple concurrent logs', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(transport);

      const logCount = 100;
      for (let i = 0; i < logCount; i++) {
        logger.info(`Concurrent log ${i}`);
      }

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLogs = testDb.prepare('SELECT * FROM logs').all() as LogRecord[];
      expect(storedLogs).toHaveLength(logCount);
    });

    it('should handle rapid log bursts', async () => {
      const transport = sqliteTransport({
        database: testDb,
        bufferLimit: 10,
        flushInterval: 100,
      });

      const logger = pino(transport);

      // Rapid burst of logs
      for (let i = 0; i < 25; i++) {
        logger.info(`Burst log ${i}`);
      }

      // Wait a bit, the transport is async
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The first 20 logs should be stored due to the buffer limit
      const storedLogs = testDb.prepare('SELECT * FROM logs').all() as LogRecord[];
      expect(storedLogs).toHaveLength(20);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 150));
      logger.flush();
      transport.end();

      // The final 5 logs should be stored due to the flush interval
      const finalLogs = testDb.prepare('SELECT * FROM logs').all() as LogRecord[];
      expect(finalLogs).toHaveLength(25);
    });
  });

  describe('structured logging', () => {
    it('should handle structured log objects', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(transport);

      const user = { id: 123, name: 'John Doe' };
      const request = { method: 'GET', url: '/api/users' };
      logger.info({ user, request }, 'User request processed');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLog = testDb.prepare('SELECT * FROM logs').get() as LogRecord;
      const parsedMeta = JSON.parse(storedLog.meta);

      expect(parsedMeta.user).toEqual(user);
      expect(parsedMeta.request).toEqual(request);
      expect(storedLog.message).toBe('User request processed');
    });

    it('should handle nested objects in metadata', async () => {
      const transport = sqliteTransport({
        database: testDb,
        flushInterval: 50,
      });

      const logger = pino(transport);

      const complexObject = {
        user: {
          id: 123,
          profile: {
            name: 'John',
            preferences: {
              theme: 'dark',
              notifications: true,
            },
          },
        },
        context: {
          session: 'abc123',
          timestamp: Date.now(),
        },
      };

      logger.info(complexObject, 'Complex structured log');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.flush();
      transport.end();

      const storedLog = testDb.prepare('SELECT * FROM logs').get() as LogRecord;
      const parsedMeta = JSON.parse(storedLog.meta);
      expect(parsedMeta.user.profile.preferences.theme).toBe('dark');
      expect(parsedMeta.context.session).toBe('abc123');
    });
  });
});
