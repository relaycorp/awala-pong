describe('GET /connection-params.der', () => {
  test.todo('Response code should be 500 if the identity key could not be retrieved');

  test.todo('Response code should be 500 if the session key could not be retrieved');

  describe('Success', () => {
    test.todo('Response code should be 200 if it went well');

    test.todo('Public address should match expected value');

    test.todo('Identity key should be DER serialization of public key');

    test.todo('Session key should be DER serialization of public key');
  });
});
