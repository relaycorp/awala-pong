FROM node:12.14.1-slim as build

WORKDIR /tmp/pong
COPY . ./
RUN pwd && ls -lA && npm install && npm run build && npm prune --production

FROM gcr.io/distroless/nodejs

COPY --from=build /tmp/pong/build/main /opt/pong/
EXPOSE 3000
CMD ["index.js"]
