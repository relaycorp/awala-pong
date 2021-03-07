import { Certificate } from '@relaycorp/relaynet-core';
import {
  generateNodeKeyPairSet,
  generatePDACertificationPath,
  PDACertPath,
} from '@relaycorp/relaynet-testing';

import { deserializePing, PingSerializationError, serializePing } from './pingSerialization';

const mockStubUuid4 = '56e95d8a-6be2-4020-bb36-5dd0da36c181';
jest.mock('uuid4', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockStubUuid4),
  };
});

let fullPdaChain: PDACertPath;
beforeAll(async () => {
  const nodeKeyPairSet = await generateNodeKeyPairSet();
  fullPdaChain = await generatePDACertificationPath(nodeKeyPairSet);
});

beforeEach(jest.restoreAllMocks);

describe('serializePing', () => {
  test('A UUID4 should be used as id if none is specified', () => {
    const pingSerialized = serializePing(fullPdaChain.pdaGrantee);

    const pingFields = jsonParse(pingSerialized);
    expect(pingFields.id).toEqual(mockStubUuid4);
  });

  test('An empty id should be refused', () => {
    expect(() => serializePing(fullPdaChain.pdaGrantee, '')).toThrowWithMessage(
      PingSerializationError,
      'Ping id should not be empty',
    );
  });

  test('Any ping id should be honored', () => {
    const id = 'the id';
    const pingSerialized = serializePing(fullPdaChain.pdaGrantee, id);

    const pingFields = jsonParse(pingSerialized);
    expect(pingFields.id).toEqual(id);
  });

  test('Specified certificate should be included', () => {
    const pingSerialized = serializePing(fullPdaChain.pdaGrantee);

    const pingFields = jsonParse(pingSerialized);
    expect(base64EncodeDERCertificate(fullPdaChain.pdaGrantee)).toEqual(pingFields.pda);
  });

  function jsonParse(serialization: Buffer): any {
    return JSON.parse(serialization.toString());
  }
});

describe('deserializePing', () => {
  test('Non-JSON values should be refused', () => {
    const malformedJSON = Buffer.from('malformed');

    expect(() => deserializePing(malformedJSON)).toThrowWithMessage(
      PingSerializationError,
      'Ping message is not JSON-serialized',
    );
  });

  test('Ping id should be required', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({ pda: base64EncodeDERCertificate(fullPdaChain.pdaGrantee) }),
    );

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'Ping id is missing or it is not a string',
    );
  });

  test('Ping id should be a string', () => {
    const invalidPing = Buffer.from(JSON.stringify({ id: 42, pda: 'malformed' }));

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'Ping id is missing or it is not a string',
    );
  });

  test('PDA should be required', () => {
    const invalidPing = Buffer.from(JSON.stringify({ id: mockStubUuid4 }));

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'PDA is missing',
    );
  });

  test('Non-base64-encoded PDA should be refused', () => {
    const invalidPing = Buffer.from(JSON.stringify({ id: mockStubUuid4, pda: '$' }));

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'PDA is not base64-encoded',
    );
  });

  test('Malformed, base64-encoded PDA should be refused', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({ id: mockStubUuid4, pda: Buffer.from('malformed').toString('base64') }),
    );

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      /^PDA is base64-encoded but not a valid DER serialization of an X.509 certificate: /,
    );
  });

  test('Valid pings should be output', () => {
    const pingSerialized = serializePing(fullPdaChain.pdaGrantee);

    const pingDeserialized = deserializePing(pingSerialized);

    expect(pingDeserialized.id.toString()).toEqual(mockStubUuid4);
    expect(pingDeserialized.pda.isEqual(fullPdaChain.pdaGrantee)).toBeTrue();
  });
});

function base64EncodeDERCertificate(certificate: Certificate): string {
  return Buffer.from(certificate.serialize()).toString('base64');
}
