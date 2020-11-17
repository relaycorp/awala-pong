// tslint:disable-next-line:no-var-requires
require('make-promises-safe');

import pino from 'pino';

import { runServer } from '../app/pohttp_endpoint/server';

async function main(): Promise<void> {
  await runServer();

  const logger = pino();
  logger.info('PoHTTP server is ready');
}

// noinspection JSIgnoredPromiseFromCall
main();
