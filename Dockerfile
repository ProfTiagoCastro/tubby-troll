# Imagem leve do Node
FROM node:22-alpine

WORKDIR /app

# Instala dependências primeiro (aproveita o cache de camadas do Docker)
COPY package*.json ./
RUN npm ci --omit=dev

# Copia o código do jogo
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Docker verifica se o app (e o banco) estão respondendo
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1

# Não roda como root
USER node
CMD ["node", "server.js"]
