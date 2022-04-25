jest.setTimeout(10_000);

const TEST_ENV_VARS = {
  POHTTP_TLS_REQUIRED: 'false',
};

// tslint:disable-next-line:no-object-mutation
Object.assign(process.env, TEST_ENV_VARS);
