# relaynet-pong
Relaynet Ping Service Application (pong messages only)

## Processes

### Server

The server runs on port `8080`.

Environment variables:

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

Then go to http://127.0.0.1:8080/

To run the functional tests locally, run `npm run test:functional`.

### Endpoint key pair

A mock RSA key pair has been created for development purposes. The private key can be found PEM-encoded in [`.env`](./.env) and the public key can be found in [the DER-encoded, self-issued X.509 certificate used in the functional tests](./src/functional_tests/endpoint-certificate.der).
