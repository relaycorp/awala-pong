import {
  INCOMING_SERVICE_MESSAGE_TYPE,
  makeOutgoingCloudEvent,
} from '@relaycorp/awala-endpoint-internet';

import { PING_CONTENT_TYPE } from '../../utilities/ping.js';

export function makePingEvent() {
  // Cheat by creating an outgoing event first, so we don't specify fields we don't care about.
  const outgoingEvent = makeOutgoingCloudEvent({
    recipientId: 'recipient',
    senderId: 'sender',
    contentType: PING_CONTENT_TYPE,
    content: Buffer.from('the ping id'),
  });
  return outgoingEvent.cloneWith({ type: INCOMING_SERVICE_MESSAGE_TYPE });
}
