FROM node:16.12.1 as build
WORKDIR /tmp/pong
COPY . ./
RUN npm install && npm run build && npm prune --production && rm -rf src/

FROM node:16.12.1-slim
LABEL org.opencontainers.image.source="https://github.com/relaycorp/relaynet-pong"
WORKDIR /opt/pong
COPY --from=build /tmp/pong ./
RUN groupadd -r pong && useradd -r -g pong pong
USER pong
CMD ["node", "build/main/bin/pohttp-server.js"]
EXPOSE 8080
