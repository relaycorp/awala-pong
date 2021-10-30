# Relaynet Pong

This is a server-side implementation of the [Relaynet Ping service](https://specs.relaynet.link/RS-014), meant to be used as a public endpoint with the [PoHTTP binding](https://specs.relaynet.link/RS-007). [Read the documentation online](https://docs.relaycorp.tech/relaynet-pong/).

## Development

Make sure to install the development dependencies when contributing to this project: Docker, docker-compose and Node.js v16+.

This project can be installed in development mode like any other Node.js project: By running `npm install` from the root of the repository.

To run the unit test suite, run `npm test` on the host computer (i.e., without running Docker).

To start the long-running processes, run: `docker-compose up --build --remove-orphan`. When running this for the first time, make sure to generate the endpoint and session keys in Vault:

```
docker-compose exec -e VAULT_ADDR='http://127.0.0.1:8200' -e VAULT_TOKEN=root vault vault secrets enable -path=pong-keys kv-v2
docker-compose run --rm queue src/bin/generate-keypairs.ts
```

The PoHTTP endpoint will be available at http://127.0.0.1:8080/.

To run the functional tests locally, run `npm run test:functional`.
