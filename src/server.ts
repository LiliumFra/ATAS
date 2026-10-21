import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);
let shuttingDown = false;

async function shutdown(signal: string, cause?: unknown): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  if (cause === undefined) app.log.info({ signal }, 'Graceful shutdown requested');
  else app.log.fatal({ signal, err: cause }, 'Fatal process error; shutting down');

  const forceTimer = setTimeout(() => {
    app.log.fatal({ signal, timeoutMs: config.shutdownTimeoutMs }, 'Forced shutdown timeout');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceTimer.unref();

  try {
    await app.close();
    clearTimeout(forceTimer);
    process.exitCode = cause === undefined ? 0 : 1;
  } catch (error) {
    clearTimeout(forceTimer);
    app.log.fatal({ err: error, signal }, 'ATAS failed to shut down cleanly');
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('uncaughtException', (error) => void shutdown('uncaughtException', error));
process.once('unhandledRejection', (reason) => void shutdown('unhandledRejection', reason));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, 'ATAS started');
} catch (error) {
  app.log.fatal({ err: error }, 'ATAS failed to start');
  await app.close().catch(() => undefined);
  process.exitCode = 1;
}
