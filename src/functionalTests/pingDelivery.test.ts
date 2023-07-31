import { HTTP_STATUS_CODES } from '../utilities/http.js';
import { makePingEvent } from '../testUtils/eventing/ping.js';
import { PONG_CONTENT_TYPE } from '../utilities/ping.js';

import { post } from './utils/http.js';
import { postEvent } from './utils/events.js';
import { PONG_ENDPOINT_URL } from './utils/pong.js';
import { getMockServerRequests, setMockServerExpectation } from './utils/mockServer.js';

const MOCK_CE_BROKER_SVC_NAME = 'mock-ce-broker';

describe('Ping delivery', () => {
  test('Malformed event should be refused', async () => {
    await setMockServerExpectation(MOCK_CE_BROKER_SVC_NAME);

    const response = await post(PONG_ENDPOINT_URL, { body: 'malformed' });

    expect(response.status).toStrictEqual(HTTP_STATUS_CODES.BAD_REQUEST);
    const requests = await getMockServerRequests(MOCK_CE_BROKER_SVC_NAME);
    expect(requests).toBeEmpty();
  });

  test('Invalid event should be refused', async () => {
    const invalidEvent = makePingEvent().cloneWith({ expiry: undefined }, false);
    await setMockServerExpectation(MOCK_CE_BROKER_SVC_NAME);

    const response = await postEvent(invalidEvent, PONG_ENDPOINT_URL);

    expect(response.status).toStrictEqual(HTTP_STATUS_CODES.BAD_REQUEST);
    const requests = await getMockServerRequests(MOCK_CE_BROKER_SVC_NAME);
    expect(requests).toBeEmpty();
  });

  test('Valid ping message should be responded to with pong message', async () => {
    const pingEvent = makePingEvent();
    await setMockServerExpectation(MOCK_CE_BROKER_SVC_NAME, {
      httpResponse: { statusCode: HTTP_STATUS_CODES.ACCEPTED },
    });

    const response = await postEvent(pingEvent, PONG_ENDPOINT_URL);

    expect(response.status).toStrictEqual(HTTP_STATUS_CODES.NO_CONTENT);
    const requests = await getMockServerRequests(MOCK_CE_BROKER_SVC_NAME);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.headers).toHaveProperty('Content-Type', [PONG_CONTENT_TYPE]);
    expect(request.headers).toHaveProperty('Ce-Source', [pingEvent.subject]);
    expect(request.headers).toHaveProperty('Ce-Subject', [pingEvent.source]);
  });
});
