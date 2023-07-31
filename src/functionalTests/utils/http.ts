type Options = Omit<Omit<RequestInit, 'method'>, 'signal'>;

const REQUEST_TIMEOUT_MS = 3000;

export async function get(url: string, options: Options = {}): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...options,
  });
}

export async function post(url: string, options: Options): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...options,
  });
}
