# Punarnava app image (the local Build It server + frontend). Used by the Kubernetes manifests (deploy/k8s, on an
# EKS Anywhere / EKS Distro cluster). Build: finch build -t punarnava/app:local .
FROM node:22-bookworm-slim
WORKDIR /app
COPY backend/package.json backend/
RUN cd backend && npm install --omit=optional --no-audit --no-fund && npm cache clean --force
COPY backend/src backend/src
COPY frontend frontend
COPY policies policies
COPY local/opensearch/mappings.json local/opensearch/mappings.json
ENV PN_HOST=0.0.0.0 PN_PORT=8787 PN_DATA_DIR=/data PN_RUNTIME=container NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "backend/src/local/server.js"]
