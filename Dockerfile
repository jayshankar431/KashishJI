FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.ts ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.ts"]
