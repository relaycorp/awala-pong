#!/bin/bash -x

set -o nounset
set -o errexit
set -o pipefail

export COMPOSE_PROJECT_NAME='pong-functional-tests'
export COMPOSE_FILE='docker-compose.yml:src/functional_tests/docker-compose.override.yml'

trap "docker-compose down --remove-orphans" INT TERM EXIT

docker-compose pull
docker-compose build

exec docker-compose up \
  --exit-code-from gateway \
  --force-recreate \
  --always-recreate-deps \
  --abort-on-container-exit
