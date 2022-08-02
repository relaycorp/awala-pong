# Install and upgrade

Relaynet Pong is distributed as a Helm chart. Note that deploying the Docker images directly is discouraged: We're likely to change paths, as well as split and rename the Docker image.

## Example

At a minimum, you have to specify the Vault authentication token; e.g.:

```
helm repo add relaycorp https://h.cfcr.io/relaycorp/public

helm install \
  --set vault.token=the-secret-token \
  pong-test \
  relaycorp/relaynet-pong
```

Check out [`relaycorp/relaynet-pong-chart`](https://github.com/relaycorp/relaynet-pong-chart/tree/master/example) for a working example on Google Cloud Platform.

## Configuration options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `nameOverride` | string | | A custom name for the release, to override the one passed to Helm |
| `logging.level` | string | `info` | The minimum log level. |
| `logging.target` | string | | Any target supported by [@relaycorp/pino-cloud](https://www.npmjs.com/package/@relaycorp/pino-cloud); e.g., `gcp`. |
| `logging.envName` | string | `awala-pong` | A unique name for this instance of the app. Used by the `gcp` target as the _service name_ when pushing errors to Google Error Reporting, for example. || `podSecurityContext` | object | `{}` | A custom `securityContext` to be attached to the pods |
| `securityContext` | object | `{}` | A custom `securityContext` to be attached to the deployments |
| `resources` | object | `{}` | A custom name `resources` to be attached to the containers |
| `service.type` | string | `ClusterIP` | The service type for the PoHTTP endpoint |
| `service.port` | number | `80` | The service port for the PoHTTP endpoint |
| `ingress.enabled` | boolean | `false` | Whether to use an ingress for the PoHTTP endpoint |
| `ingress.annotations` | object | `{}` | Annotations for the ingress |
| `redis.host` | string | `redis` | The Redis host |
| `redis.port` | number | `6379` | The Redis port |
| `vault.host` | string | `vault` | The Vault host |
| `vault.port` | number | `8200` | The Vault port |
| `vault.session_keys_mount_path` | string | `pong-keys` | The mount point for the K/V engine v2 to use |
| `vault.enable_secret` | boolean | `false` | Whether to enable the Vault K/V engine after installing the chart |
| `vault.token` (required) | string | | The Vault authentication token |
| `http_request_id_header` | string | `X-Request-Id` | The HTTP request id header to be passed to the PoHTTP endpoint server |
| `internet_address` | string | | The Internet address of the endpoint (e.g., `endpoint.com`) |
| `pohttp_tls_required` | boolean | `true` | Whether the gateway receiving a pong message must use TLS |
| `backgroundQueue.replicaCount` | number | `1` | Number of replicas for the background queue |
