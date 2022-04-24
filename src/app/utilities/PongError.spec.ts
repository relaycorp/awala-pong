import PongError from './PongError';

test('.name should be taken from the name of the class', () => {
  class FooError extends PongError {}
  const error = new FooError('Winter is coming');
  expect(error.name).toBe('FooError');
});
