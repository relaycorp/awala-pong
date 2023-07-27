# Relaynet Pong

This is a server-side implementation of the [Awala Ping service](https://specs.awala.network/RS-014), implemented as an [Awala Internet Endpoint](https://docs.relaycorp.tech/awala-endpoint-internet/) backend.

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
