# Awala Pong

This is a server-side implementation of the [Awala Ping service](https://specs.awala.network/RS-014), implemented as an [Awala Internet Endpoint](https://docs.relaycorp.tech/awala-pong/) backend.

## Architecture

This is a trivial server that simply listens for _ping_ messages and responds with a _pong_ message. Its only backing service is a [CloudEvents](https://cloudevents.io) broker supported by [`@relaycorp/cloudevents-transport`](https://www.npmjs.com/package/@relaycorp/cloudevents-transport), so that it can communicate with the Awala Internet Endpoint.

## Install

The app is distributed as a Docker image in the following registries:

- [Docker Hub](https://hub.docker.com/r/relaycorp/awala-pong): `relaycorp/awala-pong`
- [GitHub Container Registry](https://github.com/relaycorp/awala-pong/pkgs/container/awala-pong): `ghcr.io/relaycorp/awala-pong`

## Container configuration

The app listens on port `8080`, and comes with a default command that starts the server.

The server uses the following environment variables:

- [`@relaycorp/cloudevents-transport`](https://www.npmjs.com/package/@relaycorp/cloudevents-transport) configuration:
  - `CE_TRANSPORT` (default: `ce-http-binary`): The transport to use.
  - `CE_CHANNEL` (required): The transport channel to use. It can be a URL to a CloudEvents server or the name of a Google PubSub topic, for example.
- Logging configuration:
  - `LOG_TARGET` (optional): The [`@relaycorp/pino-cloud`](https://www.npmjs.com/package/@relaycorp/pino-cloud) target (e.g., `gcp`).
  - `LOG_LEVEL` (default: `info`): The [`pino` log level](https://github.com/pinojs/pino/blob/master/docs/api.md#levels).
- Instrumentation configuration:
  - `VERSION` (required): The version of the image being used. This value is used when reporting errors.
  - `REQUEST_ID_HEADER` (default: `X-Request-Id`): The name of the HTTP header that contains the request id.

The endpoint `GET /` can be used for health checks.

For a working example, refer to the [Kubernetes resources used by the functional test suite](k8s).

# Awala service messages

As an implementation of the Awala Ping Service, this app supports the following Awala service messages:

- `application/vnd.awala.ping-v1.ping` (incoming messages only).
- `application/vnd.awala.ping-v1.pong` (outgoing messages only).

# Development

To use this app locally and be able to update the source code, you need the following system dependencies:

- Node.js v20+.
- [Skaffold](https://skaffold.dev/) v2.6.

## Run unit test suite

Run unit tests selectively from your IDE, or run the whole suite with:

```bash
npm test
```

## Run functional test suite

First, run `skaffold delete` to ensure you have a clean fixture and then `skaffold run` to deploy the chart against which you'll run the tests.

Again, you can run the tests selectively from your IDE, or run the whole suite with:

```bash
npm run test:functional
```

When you're done, destroy the environment with `skaffold delete`.

## Contributing

We love contributions! If you haven't contributed to a Relaycorp project before, please take a minute to [read our guidelines](https://github.com/relaycorp/.github/blob/master/CONTRIBUTING.md) first.
