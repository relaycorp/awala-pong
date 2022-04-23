#!/bin/bash
set -o nounset
set -o errexit
set -o pipefail
set -x

# Ugly workaround for https://github.com/GoogleContainerTools/skaffold/issues/4022

function port_forward() {
  local service="$1"
  local local_port="$2"

  kubectl port-forward --address 127.0.0.1 "svc/${service}" "${local_port}:80" &
  timeout 5 sh -c "while ! wget --spider http://127.0.0.1:${local_port} ; do sleep 1s ; done"
}

port_forward relaynet-pong-pohttp 8080
port_forward mock-public-gateway 1080
