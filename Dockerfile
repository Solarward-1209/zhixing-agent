# 知行 Agent 生产镜像：构建产物 + 独立 Node 服务器
# 注意：.env 已被 .dockerignore 排除，密钥务必通过运行时环境变量注入
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY tsconfig.json vite.config.ts vitest.config.ts index.html tailwind.config.js postcss.config.js ./
COPY src ./src
COPY server ./server
COPY shared ./shared
COPY data ./data
COPY tests ./tests

RUN npm ci && npm run build

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["npx", "tsx", "server/main.ts"]
