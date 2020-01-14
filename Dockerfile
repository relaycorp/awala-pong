FROM node:12.14.1 as build
WORKDIR /tmp/pong
COPY . ./
RUN npm install && npm run build && npm prune --production && rm -rf src/

FROM node:12.14.1-slim
WORKDIR /opt/pong
COPY --from=build /tmp/pong ./
CMD ["node", "build/main/bin/pohttp-server.js"]
EXPOSE 3000
