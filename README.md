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

## Development

Requirements: Docker, docker-compose.

```
docker-compose up --build --remove-orphan
```

Then go to http://127.0.0.1:3000/
