import { mockServerClient, type Expectation, type HttpResponse } from 'mockserver-client';
import type { MockServerClient } from 'mockserver-client/mockServerClient.js';

import { connectToClusterService } from './kubernetes.js';
import { sleep } from './time.js';
import { getServiceActiveRevision } from './knative.js';

const SERVICE_PORT = 80;

const PORT_FORWARDING_DELAY_MS = 400;

type Command = (client: MockServerClient) => Promise<unknown>;

async function connectToMockServer(serviceName: string, command: Command): Promise<void> {
  const revision = await getServiceActiveRevision(serviceName);
  const privateServiceName = `${revision}-private`;
  await connectToClusterService(privateServiceName, SERVICE_PORT, async (localPort) => {
    await sleep(PORT_FORWARDING_DELAY_MS);

    const client = mockServerClient('127.0.0.1', localPort);
    await command(client);
  });
}

export async function setMockServerExpectation(
  serviceName: string,
  expectation?: Expectation,
): Promise<void> {
  await connectToMockServer(serviceName, async (client) => {
    await client.reset();
    if (expectation) {
      await client.mockAnyResponse(expectation);
    }
  });
}

export async function getMockServerRequests(serviceName: string): Promise<HttpResponse[]> {
  let requests: HttpResponse[] | undefined;
  await connectToMockServer(serviceName, async (client) => {
    requests = await client.retrieveRecordedRequests({ path: '/' });
  });

  if (requests === undefined) {
    throw new Error(`Failed to retrieve requests for ${serviceName}`);
  }
  return requests;
}
