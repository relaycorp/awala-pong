# Relaynet Pong

This is a server-side implementation of the [Relaynet Ping service](https://specs.relaynet.link/RS-014), meant to be used as a public endpoint with the [PoHTTP binding](https://specs.relaynet.link/RS-007). [Read the documentation online](https://docs.relaycorp.tech/relaynet-pong/).

# Development

To use this app locally and be able to update the source code, you need the following system dependencies:

- Node.js v14+.
- [Skaffold](https://skaffold.dev/) v1.34+.
- [Helm](https://helm.sh/) v3.4+.

You can then install the Node.js and Helm chart dependencies with:

```
npm install
helm dependency update chart/
```

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

## Run the services locally

Simply run `skaffold dev --port-forward`. The PoWeb service will then be available at `127.0.0.1:8080`.

## Access to backing services

The backing services that offer web interfaces may be accessed with the following.

- Vault:
  - URL: `http://127.0.0.1:8200`
  - Token: `root`

## Contributing

We love contributions! If you haven't contributed to a Relaycorp project before, please take a minute to [read our guidelines](https://github.com/relaycorp/.github/blob/master/CONTRIBUTING.md) first.
