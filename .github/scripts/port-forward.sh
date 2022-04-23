#!/bin/bash
set -o nounset
set -o errexit
set -o pipefail
set -x

# Ugly workaround for https://github.com/GoogleContainerTools/skaffold/issues/4022

kubectl port-forward --address 127.0.0.1 svc/relaynet-pong-pohttp 8080:80 &
kubectl port-forward --address 127.0.0.1 svc/mock-public-gateway 1080:80 &

# Check at least one of the ports:
timeout 5 sh -c "while ! wget --spider http://127.0.0.1:1080 ; do sleep 1s ; done"
