import { runFastify } from '../utilities/fastify/server.js';
import { makeServer } from '../server/server.js';

await runFastify(await makeServer());
