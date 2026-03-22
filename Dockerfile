FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY backend/ backend/
COPY frontend/ frontend/
RUN npm run build && \
    sed -i 's|app.js?v=3|app.bundle.js|' frontend/index.html
RUN npm prune --production
EXPOSE 3000
CMD ["node", "backend/server.js"]
