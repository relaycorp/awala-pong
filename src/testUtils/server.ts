import type { FastifyInstance } from 'fastify';

import { makeServer } from '../server/server.js';
import type { Emitter } from '../utilities/eventing/Emitter.js';

import { configureMockEnvVars, type EnvVarMocker, REQUIRED_ENV_VARS } from './envVars.js';
import { makeMockLogging, type MockLogSet } from './logging.js';
import { mockEmitter } from './eventing/mockEmitter.js';

interface TestServerFixture {
  readonly server: FastifyInstance;
  readonly logs: MockLogSet;
  readonly envVarMocker: EnvVarMocker;
  readonly emitter: Emitter<unknown>;
}

export function makeTestServer(): () => TestServerFixture {
  const envVarMocker = configureMockEnvVars(REQUIRED_ENV_VARS);
  const mockLogging = makeMockLogging();
  const emitter = mockEmitter();

  let server: FastifyInstance;
  beforeEach(async () => {
    server = await makeServer(mockLogging.logger);
  });

  afterEach(async () => {
    await server.close();
  });

  return () => ({
    server,
    logs: mockLogging.logs,
    envVarMocker,
    emitter,
  });
}
