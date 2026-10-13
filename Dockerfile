# Servidor HTTP da API (mesmo app da Lambda, com a documentação em /docs).
# Em produção a API roda na AWS Lambda (ver README); esta imagem serve para
# rodar localmente ou em qualquer máquina com Docker.

ARG NODE_VERSION=24-alpine

# 1) Build: instala todas as dependências e gera dist/server.js
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN npm install -g pnpm@12.5.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json esbuild.config.js ./
COPY src ./src
RUN pnpm build

# 2) Somente as dependências de produção
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN npm install -g pnpm@12.5.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# 3) Imagem final
FROM node:${NODE_VERSION}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist/server.js ./dist/server.js
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/docs/json || exit 1
CMD ["node", "dist/server.js"]
