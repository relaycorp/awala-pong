import {
  INCOMING_SERVICE_MESSAGE_TYPE,
  makeOutgoingCloudEvent,
} from '@relaycorp/awala-endpoint-internet';

import { makeTestServer } from '../../testUtils/server.js';
import { postEvent } from '../../testUtils/eventing/cloudEvents.js';
import { HTTP_STATUS_CODES } from '../../utilities/http.js';
import { mockEmitter } from '../../testUtils/eventing/mockEmitter.js';
import { partialPinoLog } from '../../testUtils/logging.js';

describe('Pong route', () => {
  const getTestServerFixture = makeTestServer();
  const emitter = mockEmitter();

  const pingEvent = makeOutgoingCloudEvent({
    recipientId: 'recipient',
    senderId: 'sender',
    contentType: 'application/vnd.awala.ping-v1.ping',
    content: Buffer.from('the ping id'),
  }).cloneWith({ type: INCOMING_SERVICE_MESSAGE_TYPE });

  test('should refuse malformed events', async () => {
    const { server, logs } = getTestServerFixture();

    const response = await server.inject({
      method: 'POST',
      url: '/',
      payload: Buffer.from('malformed'),
    });

    expect(response).toHaveProperty('statusCode', HTTP_STATUS_CODES.BAD_REQUEST);
    expect(response.json()).toHaveProperty('message', 'Malformed event');
    expect(emitter.events).toBeEmpty();
    expect(logs).toContainEqual(
      partialPinoLog('warn', 'Refused malformed event', {
        err: expect.objectContaining({ type: 'ValidationError' }),
      }),
    );
  });

  test('should refuse incompatible events', async () => {
    const invalidEvent = pingEvent.cloneWith({ expiry: undefined }, false);
    const { server, logs } = getTestServerFixture();

    const response = await postEvent(invalidEvent, server);

    expect(response).toHaveProperty('statusCode', HTTP_STATUS_CODES.BAD_REQUEST);
    expect(response.json()).toHaveProperty(
      'message',
      'CloudEvent is incompatible with the Awala Internet Endpoint',
    );
    expect(emitter.events).toBeEmpty();
    expect(logs).toContainEqual(
      partialPinoLog('warn', 'Refused incompatible event', {
        err: expect.objectContaining({ type: 'Error' }),
      }),
    );
  });

  test('should refuse non-Ping messages', async () => {
    const invalidEvent = pingEvent.cloneWith({
      datacontenttype: `${pingEvent.datacontenttype!}.not`,
    });
    const { server, logs } = getTestServerFixture();

    const response = await postEvent(invalidEvent, server);

    expect(response).toHaveProperty('statusCode', HTTP_STATUS_CODES.BAD_REQUEST);
    expect(response.json()).toHaveProperty(
      'message',
      `Invalid ping content type (${invalidEvent.datacontenttype!})`,
    );
    expect(emitter.events).toBeEmpty();
    expect(logs).toContainEqual(
      partialPinoLog('warn', 'Refused non-ping message', {
        contentType: invalidEvent.datacontenttype,
        peerId: invalidEvent.source,
      }),
    );
  });

  test('should reply to Ping messages', async () => {
    const { server, logs } = getTestServerFixture();

    const response = await postEvent(pingEvent, server);

    expect(response).toHaveProperty('statusCode', HTTP_STATUS_CODES.NO_CONTENT);
    expect(emitter.events).toHaveLength(1);
    const [pongEvent] = emitter.events;
    expect(pongEvent.source).toBe(pingEvent.subject);
    expect(pongEvent.subject).toBe(pingEvent.source);
    expect(pongEvent.datacontenttype).toBe('application/vnd.awala.ping-v1.pong');
    expect(pongEvent.data).toMatchObject(pingEvent.data!);
    expect(logs).toContainEqual(
      partialPinoLog('info', 'Replied to ping message', {
        peerId: pingEvent.source,
        pingParcelId: pingEvent.id,
        pongParcelId: pongEvent.id,
      }),
    );
  });
});
