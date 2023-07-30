FROM node:20.5.0 as build
WORKDIR /tmp/awala-pong
COPY package*.json ./
RUN npm install
COPY . ./
RUN npm run build && npm prune --omit=dev && rm -r src

FROM node:20.5.0-slim
LABEL org.opencontainers.image.source="https://github.com/relaycorp/awala-pong"
USER node
WORKDIR /opt/awala-pong
COPY --chown=node:node --from=build /tmp/awala-pong ./
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
CMD ["node", "--unhandled-rejections=strict", "--experimental-vm-modules", "--enable-source-maps", "build/bin/server.js"]
EXPOSE 8080
