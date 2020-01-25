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

When running for the first time, make sure to generate the endpoint keys in Vault:

```
 docker-compose exec -e VAULT_ADDR='http://127.0.0.1:8200' -e VAULT_TOKEN=letmein vault vault secrets enable -path=pong-keys kv-v2

docker-compose run --rm queue src/bin/generate-endpoint-keypair.ts
```

Then go to http://127.0.0.1:8080/

To run the functional tests locally, run `npm run test:functional`.
