import { HTTP_STATUS_CODES } from '../utilities/http.js';

import { get } from './utils/http.js';
import { PONG_ENDPOINT_URL } from './utils/pong.js';

describe('Health checks', () => {
  test('should return 200 OK for /', async () => {
    const response = await get(PONG_ENDPOINT_URL);

    expect(response.status).toBe(HTTP_STATUS_CODES.OK);
  });
});
