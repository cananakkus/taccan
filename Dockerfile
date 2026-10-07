FROM node:22-alpine AS builder
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci
COPY backend/ backend/
COPY frontend/ frontend/
COPY tsconfig.json ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node --from=builder /app/backend/ backend/
COPY --chown=node:node --from=builder /app/frontend/dist/ frontend/dist/
RUN mkdir -p /app/state && printf '[]' > /app/.taccan-state.json && chown node:node /app /app/state /app/.taccan-state.json
ENV HOST=0.0.0.0 NODE_ENV=production
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/server.js"]
