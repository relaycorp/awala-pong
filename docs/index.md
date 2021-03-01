---
layout: page
title: Relaynet Pong
---
# Relaynet Pong

This is a server-side implementation of the [Relaynet Ping service](https://specs.relaynet.link/RS-014), meant to be used as a public endpoint with the [PoHTTP binding](https://specs.relaynet.link/RS-007). This application only sends [pong messages](https://specs.relaynet.link/RS-014#pong) in response to [pings](https://specs.relaynet.link/RS-014#ping).

This documentation is meant for contributors. If you're interested in deploying Relaynet Pong, please do so using [the Helm chart](https://github.com/relaycorp/relaynet-pong-chart) as that's the only official way to deploy the app. Using the [Docker image](https://hub.docker.com/r/relaycorp/relaynet-pong) directly works but is not recommended, as backwardly compatible changes will be likely until the project stabilizes.

[Relaycorp](https://relaycorp.tech/) plans to host a public instance of this application as a service to the Relaynet community by the end of 2020, but anyone is welcome to deploy private or public instances of this service.

## Architecture and Backing Services

This project is implemented with Node.js and the following backing services:

- [Hashicorp Vault](https://www.vaultproject.io/), to manage private keys securely. Vault itself can in turn be configured to use additional backing services, such as MongoDB for persistent storage.
- [Redis](https://redis.io/), to run background jobs using its pubsub functionality.

The [PoHTTP endpoint](https://github.com/relaycorp/relaynet-pong/tree/master/src/app/pohttp_endpoint) is powered by the [Fastify](https://www.fastify.io/) framework. When a valid parcel is received, the relevant data is added to a Redis-backed background job so the pong message can be processed out of band.

The [background queue](https://github.com/relaycorp/relaynet-pong/tree/master/src/app/background_queue) is powered by [Bull](https://github.com/OptimalBits/bull), which is configured with a single job that processes the queued ping messages by producing a corresponding pong response.

This application uses [@relaycorp/relaynet-core](https://docs.relaycorp.tech/relaynet-core-js/) behind the scenes, so it supports all the cryptographic algorithms supported by that library.

## Releases

This image is automatically pushed to the Docker repository [`relaycorp/relaynet-pong`](https://hub.docker.com/r/relaycorp/relaynet-pong). Using the `latest` tag is not recommended: Instead, the tag for the corresponding version should be used (e.g., `v1.2.1`). This project uses [semantic versioning v2](https://semver.org/).

The changelog is available on GitHub.

## Processes

The Docker image exposes the following long-running processes and scripts:

### PoHTTP Endpoint

This is an HTTP server implementing the PoHTTP binding. It listens on the address `0.0.0.0:8080`.

- Command: `node build/main/bin/pohttp-server.js`
- Environment variables:
  - `PONG_REQUEST_ID_HEADER` (default: `X-Request-Id`). If you're using a reverse proxy and it sets a unique id for each request in the headers, you can use this to map such requests to the requests that make it to the back-end. This can be useful when troubleshooting.
  - Redis environment variables (see below).

### Background queue

The Bull-backed queue runs as a headless services, with no interface other than signals (e.g., `SIGTERM`).

- Command: `node build/main/bin/background-queue.js`
- Environment variables:
  - `ENDPOINT_KEY_ID` (required). The base64-encoded id for the current long-term node key pair -- This is typically an X.509 serial number, hence the base64 encoding. This value should be updated when doing key rotation.
  - Redis environment variables (see below).
  - Vault environment variables (see below).

### Script to generate key pairs

This script generates the initial key pairs for the endpoint: The long-term node keys (RSA) and the [initial session keys](https://specs.relaynet.link/RS-003) (ECDH). The private keys are stored in Vault and their corresponding X.509 certificates are output.

- Command: `node build/main/bin/generate-keypairs.js`
- Environment variables:
  - `ENDPOINT_KEY_ID` (see below). The id to use when saving the new long-term node key pair.
  - Vault environment variables (see below).

No key pair will be generated when there's a private key whose id matches `ENDPOINT_KEY_ID`, so make sure to update that environment variable before running the script.

### Common environment variables

`ENDPOINT_KEY_ID` does not have to be a cryptographically-secure, random string: It's only used to identify a relatively small number of key pairs. However, because this value should not be reused when rotating keys, it may be easier to satisfy this requirement by using a random string.

Variables relevant to processes using Redis:

- `REDIS_HOST` (required).
- `REDIS_PORT` (default: `6379`).
- `POHTTP_TLS_REQUIRED` (default: `true`).

Variables relevant to processes using Hashicorp Vault:

- `VAULT_URL` (required). The URL to the Vault instance. For example, `https://vault.example.com:8200`.
- `VAULT_TOKEN` (required). The authentication token.
- `VAULT_KV_PREFIX` (required). The mount path for the K/V version 2 secrets used to store private keys.
