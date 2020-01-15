// tslint:disable-next-line:no-var-requires
require('make-promises-safe');

import processPing from '../app/background_queue/processor';
import { initQueue } from '../app/background_queue/queue';

const QUEUE = initQueue();
const isTypeScript = __filename.endsWith('ts');
if (isTypeScript) {
  // Script is being run by ts-node, so we're in development. Run processor in current process and
  // get automatic module reloading.
  QUEUE.process(processPing);
} else {
  // Script is being run by node. We may be in production, so run processor in separate process.
  QUEUE.process('../app/background_queue/processor');
}
