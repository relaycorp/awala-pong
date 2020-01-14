import envVar from 'env-var';

export function getMockContext(mockedObject: any): jest.MockContext<any, any> {
  const mockInstance = (mockedObject as unknown) as jest.MockInstance<any, any>;
  return mockInstance.mock;
}

export function mockEnvVars(envVars: { readonly [key: string]: string }): void {
  jest.spyOn(envVar, 'get').mockImplementation((...args: readonly any[]) => {
    const originalEnvVar = jest.requireActual('env-var');
    const env = originalEnvVar.from(envVars);

    return env.get(...args);
  });
}
