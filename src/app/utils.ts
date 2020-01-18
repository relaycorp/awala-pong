export function base64Encode(payload: ArrayBuffer): string {
  return Buffer.from(payload).toString('base64');
}

export function base64Decode(encodedValue: string): Buffer {
  return Buffer.from(encodedValue, 'base64');
}
