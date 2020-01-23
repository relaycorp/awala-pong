import { Certificate, RelaynetError } from '@relaycorp/relaynet-core';
import { Parser } from 'binary-parser';
import bufferToArray = require('buffer-to-arraybuffer');
import uuid4 from 'uuid4';

const pingParser = new Parser()
  .endianess('little')
  .buffer('id', { length: 36 })
  .uint16('pdaLength')
  .buffer('pda', { length: 'pdaLength' });

export class PingSerializationError extends RelaynetError {}

export interface Ping {
  readonly id: Buffer;
  readonly pda: Certificate;
}

export function serializePing(pda: Certificate, id?: Buffer): Buffer {
  if (id !== undefined && id.byteLength !== 36) {
    throw new PingSerializationError(`Ping id should span 36 octets (got ${id.byteLength})`);
  }

  const finalId = id ?? Buffer.from(uuid4());
  const idSerialized = Buffer.from(finalId);
  const pdaSerialized = Buffer.from(pda.serialize());
  const pdaLengthPrefix = Buffer.allocUnsafe(2);
  pdaLengthPrefix.writeUInt16LE(pdaSerialized.byteLength, 0);
  return Buffer.concat([idSerialized, pdaLengthPrefix, pdaSerialized]);
}

export function deserializePing(pingSerialized: Buffer): Ping {
  // tslint:disable-next-line:no-let
  let pingFields: { readonly id: Buffer; readonly pda: Buffer };
  try {
    pingFields = pingParser.parse(pingSerialized);
  } catch (error) {
    throw new PingSerializationError(error, 'Invalid ping serialization');
  }
  // tslint:disable-next-line:no-let
  let pda: Certificate;
  try {
    pda = Certificate.deserialize(bufferToArray(pingFields.pda));
  } catch (error) {
    throw new PingSerializationError(error, 'Invalid PDA serialization');
  }
  return { id: pingFields.id, pda };
}
