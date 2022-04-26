export function catchError<ErrorType extends Error>(
  func: () => void,
  errorClass: new () => ErrorType,
): ErrorType {
  try {
    func();
  } catch (error) {
    if (!(error instanceof errorClass)) {
      throw error;
    }
    return error as ErrorType;
  }
  throw new Error('Expected function to throw');
}
