import { jest } from '@jest/globals';
import { pino } from 'pino';
import type { FastifyInstance } from 'fastify';

import { mockSpy } from '../testUtils/jest.js';

const mockFastify: FastifyInstance = {
  register: mockSpy(jest.fn()),
} as any;
jest.unstable_mockModule('../utilities/fastify/server.js', () => ({
  makeFastify: jest.fn<() => Promise<any>>().mockResolvedValue(mockFastify),
}));

const { makeServer } = await import('./server.js');
const { makeFastify } = await import('../utilities/fastify/server.js');

describe('makePohttpServer', () => {
  test('No logger should be passed by default', async () => {
    await makeServer();

    expect(makeFastify).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  test('Any explicit logger should be honored', async () => {
    const logger = pino();

    await makeServer(logger);

    expect(makeFastify).toHaveBeenCalledWith(expect.anything(), logger);
  });

  test('Server instance should be returned', async () => {
    const serverInstance = await makeServer();

    expect(serverInstance).toBe(mockFastify);
  });
});
