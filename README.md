# relaynet-pong
Relaynet Ping Service Application (pong messages only)

## Processes

### Server

Environment variables:

- `PONG_PORT` (default: `3000`).
- `PONG_HOST` (default: `0.0.0.0`). `0.0.0.0` is used by default instead of `127.0.0.1` because the server is only meant to be used via Docker.
- `PONG_REQUEST_ID_HEADER` (default: `X-Request-Id`).

### Background queue

- `VAULT_URL`
- `VAULT_TOKEN`
- `VAULT_KV_PREFIX`

### Common environment variables

- `REDIS_HOST` (required).
- `REDIS_PORT` (`6379`)
- `POHTTP_TLS_REQUIRED` (default: `true`)

## Development

Requirements: Docker, docker-compose.

```
docker-compose up --build --remove-orphan
```

Then go to http://127.0.0.1:3000/

To run the functional tests locally, run `npm run test:functional`.

### Endpoint key pair

A mock RSA key pair has been created for development purposes. The private key can be found PEM-encoded in [`.env`](./.env) and the public key can be found in [the DER-encoded, self-issued X.509 certificate used in the functional tests](./src/functional_tests/endpoint-certificate.der).
