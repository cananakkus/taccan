FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY backend/ backend/
COPY frontend/ frontend/
COPY tsconfig.json ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/backend/ backend/
COPY --from=builder /app/frontend/dist/ frontend/dist/
EXPOSE 3000
CMD ["node", "backend/server.js"]
