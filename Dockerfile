FROM node:12.14.1-slim

WORKDIR /opt/pong
COPY . ./
RUN npm install && npm run build && npm prune --production

CMD ["build/main/bin/server.js"]
EXPOSE 3000
