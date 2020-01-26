// tslint:disable-next-line:no-var-requires
require('make-promises-safe');

import { get as getEnvVar } from 'env-var';

import { initQueue } from '../app/background_queue/queue';
import worker from '../app/background_queue/worker';

getEnvVar('ENDPOINT_KEY_ID').required();

const QUEUE = initQueue();
const isTypeScript = __filename.endsWith('ts');
if (isTypeScript) {
  // Script is being run by ts-node, so we're in development. Run processor in current process and
  // get automatic module reloading.
  QUEUE.process(worker);
} else {
  // Script is being run by node. We may be in production, so run processor in separate process.
  QUEUE.process(__dirname + '/../app/background_queue/worker');
}

// tslint:disable-next-line:no-console
console.log('Master process started');
