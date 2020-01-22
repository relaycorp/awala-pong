#!/bin/bash

set -o nounset
set -o errexit
set -o pipefail

export COMPOSE_PROJECT_NAME='pong-functional-tests'
export COMPOSE_FILE='docker-compose.yml:src/functional_tests/docker-compose.override.yml'

trap "docker-compose down --remove-orphans" INT TERM EXIT

docker-compose pull
docker-compose build

docker-compose up --detach vault
sleep 2s
docker-compose exec -e 'VAULT_ADDR=http://127.0.0.1:8200' -e 'VAULT_TOKEN=letmein' vault \
  vault secrets enable -path=session-keys kv-v2

exec docker-compose up \
  --exit-code-from gateway \
  --force-recreate \
  --always-recreate-deps \
  --abort-on-container-exit
