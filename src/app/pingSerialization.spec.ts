import { CertificationPath, InvalidMessageError } from '@relaycorp/relaynet-core';
import {
  generateIdentityKeyPairSet,
  generatePDACertificationPath,
} from '@relaycorp/relaynet-testing';
import { GATEWAY_INTERNET_ADDRESS } from '../testUtils/awala';
import { catchError } from '../testUtils/errors';

import { deserializePing, PingSerializationError, serializePing } from './pingSerialization';

const mockStubUuid4 = '56e95d8a-6be2-4020-bb36-5dd0da36c181';
jest.mock('uuid4', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockStubUuid4),
  };
});

let pdaPath: CertificationPath;
beforeAll(async () => {
  const nodeKeyPairSet = await generateIdentityKeyPairSet();
  const certificationPath = await generatePDACertificationPath(nodeKeyPairSet);
  pdaPath = new CertificationPath(certificationPath.pdaGrantee, [
    certificationPath.privateEndpoint,
  ]);
});

beforeEach(jest.restoreAllMocks);

describe('serializePing', () => {
  test('A UUID4 should be used as id if none is specified', () => {
    const pingSerialized = serializePing(pdaPath, GATEWAY_INTERNET_ADDRESS);

    const pingFields = jsonParse(pingSerialized);
    expect(pingFields.id).toEqual(mockStubUuid4);
  });

  test('An empty id should be refused', () => {
    expect(() => serializePing(pdaPath, GATEWAY_INTERNET_ADDRESS, '')).toThrowWithMessage(
      PingSerializationError,
      'Ping id should not be empty',
    );
  });

  test('Any ping id should be honored', () => {
    const id = 'the id';
    const pingSerialized = serializePing(pdaPath, GATEWAY_INTERNET_ADDRESS, id);

    const pingFields = jsonParse(pingSerialized);
    expect(pingFields.id).toEqual(id);
  });

  test('Specified PDA path should be included', () => {
    const pingSerialized = serializePing(pdaPath, GATEWAY_INTERNET_ADDRESS);

    const pingFields = jsonParse(pingSerialized);
    expect(pingFields.pda_path).toEqual(base64EncodeCertPath(pdaPath));
  });

  test('Specified endpoint Internet address should be honored', async () => {
    const pingSerialized = serializePing(pdaPath, GATEWAY_INTERNET_ADDRESS);

    const pingFields = jsonParse(pingSerialized);
    expect(pingFields.endpoint_internet_address).toEqual(GATEWAY_INTERNET_ADDRESS);
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
    const invalidPing = Buffer.from(JSON.stringify({ pda_path: base64EncodeCertPath(pdaPath) }));

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'Ping id is missing or it is not a string',
    );
  });

  test('Ping id should be a string', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({ id: 42, pda_path: base64EncodeCertPath(pdaPath) }),
    );

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'Ping id is missing or it is not a string',
    );
  });

  test('Endpoint Internet address should be required', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({ id: mockStubUuid4, pda_path: base64EncodeCertPath(pdaPath) }),
    );

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'Endpoint Internet address is missing or malformed',
    );
  });

  test('Endpoint Internet address should be a string', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({
        id: mockStubUuid4,
        pda_path: base64EncodeCertPath(pdaPath),
        endpoint_internet_address: 42,
      }),
    );

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'Endpoint Internet address is missing or malformed',
    );
  });

  test('Endpoint Internet address should be well-formed', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({
        id: mockStubUuid4,
        pda_path: base64EncodeCertPath(pdaPath),
        endpoint_internet_address: 'not a domain name',
      }),
    );

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'Endpoint Internet address is missing or malformed',
    );
  });

  test('PDA path should be required', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({ id: mockStubUuid4, endpoint_internet_address: GATEWAY_INTERNET_ADDRESS }),
    );

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'PDA path is absent',
    );
  });

  test('Non-base64-encoded PDA path should be refused', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({
        id: mockStubUuid4,
        endpoint_internet_address: GATEWAY_INTERNET_ADDRESS,
        pda_path: '$',
      }),
    );

    expect(() => deserializePing(invalidPing)).toThrowWithMessage(
      PingSerializationError,
      'PDA path is not base64-encoded',
    );
  });

  test('Malformed, base64-encoded PDA path should be refused', () => {
    const invalidPing = Buffer.from(
      JSON.stringify({
        id: mockStubUuid4,
        endpoint_internet_address: GATEWAY_INTERNET_ADDRESS,
        pda_path: Buffer.from('malformed').toString('base64'),
      }),
    );

    const error = catchError(() => deserializePing(invalidPing), PingSerializationError);

    expect(error.message).toStartWith('Malformed PDA path');
    expect(error.cause()).toBeInstanceOf(InvalidMessageError);
  });

  test('Valid pings should be output', () => {
    const pingSerialized = serializePing(pdaPath, GATEWAY_INTERNET_ADDRESS);

    const pingDeserialized = deserializePing(pingSerialized);

    expect(pingDeserialized.id.toString()).toEqual(mockStubUuid4);
    expect(pingDeserialized.endpointInternetAddress).toEqual(GATEWAY_INTERNET_ADDRESS);
    expect(pingDeserialized.pdaPath.leafCertificate.isEqual(pdaPath.leafCertificate)).toBeTrue();
    expect(pingDeserialized.pdaPath.certificateAuthorities).toHaveLength(
      pdaPath.certificateAuthorities.length,
    );
    pingDeserialized.pdaPath.certificateAuthorities.forEach((certificate, index) => {
      expect(certificate.isEqual(pdaPath.certificateAuthorities[index])).toBeTrue();
    });
  });
});

function base64EncodeCertPath(certificatePath: CertificationPath): string {
  return Buffer.from(certificatePath.serialize()).toString('base64');
}
