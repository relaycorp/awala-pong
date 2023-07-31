import { getServiceUrl } from './knative.js';

export const PONG_ENDPOINT_URL = await getServiceUrl('awala-pong');
