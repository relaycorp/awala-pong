import { getServiceUrl } from './knative.js';

export const PONG_ENDPOIINT_URL = await getServiceUrl('awala-pong');
