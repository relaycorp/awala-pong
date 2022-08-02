import envVar from 'env-var';

interface EnvVarSet {
  readonly [key: string]: string | undefined;
}

export function configureMockEnvVars(envVars: EnvVarSet = {}): (envVars: EnvVarSet) => void {
  const mockEnvVarGet = jest.spyOn(envVar, 'get');

  function setEnvVars(newEnvVars: EnvVarSet): void {
    mockEnvVarGet.mockImplementation((...args: readonly any[]) => {
      const originalEnvVar = jest.requireActual('env-var');
      const env = originalEnvVar.from(newEnvVars);
      return env.get(...args);
    });
  }

  beforeEach(() => setEnvVars(envVars));
  afterEach(() => mockEnvVarGet.mockReset());
  afterAll(() => mockEnvVarGet.mockRestore());

  return (newEnvVars: EnvVarSet) => setEnvVars(newEnvVars);
}
