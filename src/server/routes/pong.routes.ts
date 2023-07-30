import {
  makeIncomingServiceMessage,
  makeOutgoingCloudEvent,
} from '@relaycorp/awala-endpoint-internet';
import type { FastifyInstance } from 'fastify';

import { HTTP_STATUS_CODES } from '../../utilities/http.js';
import { convertMessageToEvent } from '../../utilities/eventing/receiver.js';
import { Emitter } from '../../utilities/eventing/Emitter.js';

const PING_CONTENT_TYPE = 'application/vnd.awala.ping-v1.ping';
const PONG_CONTENT_TYPE = 'application/vnd.awala.ping-v1.pong';

export default async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // Accept any content type
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, next) => {
    next(null, payload);
  });

  const emitter = await Emitter.init();

  fastify.route({
    method: 'POST',
    url: '/',

    async handler(request, reply) {
      let event;
      try {
        event = convertMessageToEvent(request.headers, request.body as Buffer);
      } catch (err) {
        request.log.warn({ err }, 'Refused malformed event');
        return await reply.code(HTTP_STATUS_CODES.BAD_REQUEST).send({ message: 'Malformed event' });
      }

      let pingMessage;
      try {
        pingMessage = makeIncomingServiceMessage(event);
      } catch (err) {
        request.log.warn({ err }, 'Refused incompatible event');
        return await reply
          .code(HTTP_STATUS_CODES.BAD_REQUEST)
          .send({ message: 'CloudEvent is incompatible with the Awala Internet Endpoint' });
      }

      const peerAwareLog = request.log.child({ peerId: pingMessage.senderId });

      if (pingMessage.contentType !== PING_CONTENT_TYPE) {
        peerAwareLog.warn({ contentType: pingMessage.contentType }, 'Refused non-ping message');
        return reply
          .code(HTTP_STATUS_CODES.BAD_REQUEST)
          .send({ message: `Invalid ping content type (${pingMessage.contentType})` });
      }

      const pongEvent = makeOutgoingCloudEvent({
        recipientId: pingMessage.senderId,
        senderId: pingMessage.recipientId,
        contentType: PONG_CONTENT_TYPE,
        content: pingMessage.content,
      });
      await emitter.emit(pongEvent);
      peerAwareLog.info(
        { pingParcelId: pingMessage.parcelId, pongParcelId: pongEvent.id },
        'Replied to ping message',
      );
      return reply.code(HTTP_STATUS_CODES.NO_CONTENT).send();
    },
  });
}
