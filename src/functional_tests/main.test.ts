import { generateRSAKeyPair } from '@relaycorp/relaynet-core';
import { deliverParcel } from '@relaycorp/relaynet-pohttp';
// import axios from 'axios';
import bufferToArray from 'buffer-to-arraybuffer';
import * as dockerCompose from 'docker-compose';
import { Stubborn } from 'stubborn-ws';
import { generateStubNodeCertificate, generateStubPingParcel } from '../app/_test_utils';

const PONG_SERVICE_ENDPOINT = 'http://127.0.0.1:3000/';

describe('End-to-end test for successful delivery of ping and pong messages', () => {
  //region Configure Stubborn
  const mockGatewayServer = new Stubborn();
  beforeAll(async () => mockGatewayServer.start());
  afterAll(async () => mockGatewayServer.stop());
  afterEach(() => mockGatewayServer.clear());
  //endregion

  configureDockerComposeProject();

  beforeAll(() => {
    // tslint:disable-next-line:no-object-mutation
    process.env.POHTTP_TLS_REQUIRED = 'false';
  });

  test('Gateway should receive pong message', async () => {
    const gatewayEndpointRoute = mockGatewayServer.post('/').setResponseStatusCode(202);

    const endpointKeyPair = await generateRSAKeyPair();
    const endpointCertificate = await generateStubNodeCertificate(
      endpointKeyPair.publicKey,
      endpointKeyPair.privateKey,
    );
    const pingParcel = bufferToArray(
      await generateStubPingParcel(PONG_SERVICE_ENDPOINT, endpointCertificate),
    );
    await deliverParcel(PONG_SERVICE_ENDPOINT, pingParcel, {
      relayAddress: mockGatewayServer.getOrigin(),
    });

    await sleep(4000);

    expect(gatewayEndpointRoute.countCalls()).toEqual(1);

    // const body = { some: 'body' };
    //
    // const res = await axios.get(`${mockGatewayServer.getOrigin()}`);
    //
    // expect(res.data).toEqual(body);
  });
});

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function configureDockerComposeProject(): void {
  // tslint:disable-next-line:readonly-array
  const GLOBAL_DOCKER_COMPOSE_OPTIONS = ['--project-name', 'pong-functional-tests'];
  beforeAll(async () => {
    const upResult = await dockerCompose.upAll({
      commandOptions: ['--remove-orphans'],
      composeOptions: GLOBAL_DOCKER_COMPOSE_OPTIONS,
    });
    expect(upResult).toHaveProperty('exitCode', 0);

    await sleep(2000);
  });

  beforeAll(async () => {
    const enableVaultSecretsResult = await dockerCompose.exec(
      'vault',
      ['vault', 'secrets', 'enable', '-path=session-keys', 'kv-v2'],
      {
        commandOptions: ['-e', 'VAULT_ADDR=http://127.0.0.1:8200', '-e', 'VAULT_TOKEN=letmein'],
        composeOptions: GLOBAL_DOCKER_COMPOSE_OPTIONS,
      },
    );
    expect(enableVaultSecretsResult).toHaveProperty('exitCode', 0);
  });

  afterEach(async () => {
    const logsResult = await dockerCompose.logs(['app', 'queue', 'redis', 'vault'], {
      composeOptions: GLOBAL_DOCKER_COMPOSE_OPTIONS,
    });
    expect(logsResult).toHaveProperty('exitCode', 0);
    // tslint:disable-next-line:no-console
    console.log(logsResult.out);
  });

  afterAll(async () => {
    const downResult = await dockerCompose.down({
      commandOptions: ['--remove-orphans'],
      composeOptions: GLOBAL_DOCKER_COMPOSE_OPTIONS,
    });
    expect(downResult).toHaveProperty('exitCode', 0);
  });
}
