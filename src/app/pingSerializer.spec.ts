/* tslint:disable:no-let */
import { Certificate, generateRSAKeyPair } from '@relaycorp/relaynet-core';
import { Parser } from 'binary-parser';

import { expectBuffersToEqual, generateStubNodeCertificate } from './_test_utils';
import { deserializePing, PingSerializationError, serializePing } from './pingSerializer';

const pingParser = new Parser()
  .endianess('little')
  .buffer('id', { length: 36 })
  .uint16('pdaLength')
  .buffer('pda', { length: 'pdaLength' });

const mockStubUuid4 = '56e95d8a-6be2-4020-bb36-5dd0da36c181';
jest.mock('uuid4', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockStubUuid4),
  };
});

let pda: Certificate;
beforeAll(async () => {
  const keyPair = await generateRSAKeyPair();
  pda = await generateStubNodeCertificate(keyPair.publicKey, keyPair.privateKey);
});

beforeEach(jest.restoreAllMocks);

describe('serializePing', () => {
  test('A UUID4 should be used as id if none is specified', () => {
    const pingSerialized = serializePing(pda);

    const pingFields = pingParser.parse(pingSerialized);
    expect(pingFields.id.toString()).toEqual(mockStubUuid4);
  });

  test('Any explicit id with a length other than 36 octets should be refused', () => {
    expect(() => serializePing(pda, Buffer.from('a'.repeat(35)))).toThrowWithMessage(
      PingSerializationError,
      'Ping id should span 36 octets (got 35)',
    );

    expect(() => serializePing(pda, Buffer.from('a'.repeat(37)))).toThrowWithMessage(
      PingSerializationError,
      'Ping id should span 36 octets (got 37)',
    );
  });

  test('Any explicit, 36-long id should be honored', () => {
    const id = Buffer.from('a'.repeat(36));
    const pingSerialized = serializePing(pda, id);

    const pingFields = pingParser.parse(pingSerialized);
    expect(pingFields.id.toString()).toEqual(id.toString());
  });

  test('Specified certificate should be included', () => {
    const id = Buffer.from('a'.repeat(36));
    const pingSerialized = serializePing(pda, id);

    const pingFields = pingParser.parse(pingSerialized);
    expectBuffersToEqual(pingFields.pda, Buffer.from(pda.serialize()));
  });
});

describe('deserializePing', () => {
  test('Ping parsing errors should be wrapped', () => {
    const pingSerialized = Buffer.from('invalid');

    expect(() => deserializePing(pingSerialized)).toThrowWithMessage(
      PingSerializationError,
      /^Invalid ping serialization: /,
    );
  });

  test('Id should be output', () => {
    const pingSerialized = serializePing(pda);

    const pingDeserialized = deserializePing(pingSerialized);

    expect(pingDeserialized.id.toString()).toEqual(mockStubUuid4);
  });

  test('PDA should be output deserialized', () => {
    jest.spyOn(Certificate, 'deserialize').mockReturnValueOnce(pda);
    const pingSerialized = serializePing(pda);

    const pingDeserialized = deserializePing(pingSerialized);

    expect(Certificate.deserialize).toBeCalledTimes(1);
    expect(pingDeserialized).toHaveProperty('pda', pda);
  });

  test('PDA parsing errors should be wrapped', () => {
    const error = new Error('Nope');
    jest.spyOn(Certificate, 'deserialize').mockImplementationOnce(() => {
      throw error;
    });
    const pingSerialized = serializePing(pda);

    expect(() => deserializePing(pingSerialized)).toThrowWithMessage(
      PingSerializationError,
      /^Invalid PDA serialization: Nope/,
    );
  });
});
