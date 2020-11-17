// tslint:disable-next-line:no-var-requires
require('make-promises-safe');

import pino from 'pino';

import { initQueue } from '../app/background_queue/queue';
import worker from '../app/background_queue/worker';

async function main(): Promise<void> {
  const queue = initQueue();
  // noinspection ES6MissingAwait
  queue.process(worker);

  await queue.isReady();

  const logger = pino();
  logger.info('Background queue is ready');
}

main();
