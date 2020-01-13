export function getMockContext(mockedObject: any): jest.MockContext<any, any> {
  const mockInstance = (mockedObject as unknown) as jest.MockInstance<any, any>;
  return mockInstance.mock;
}
