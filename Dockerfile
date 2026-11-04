# Dipakai Coolify (Build Pack: Dockerfile). Vercel mengabaikan file ini.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
USER node
CMD ["node", "server.js"]
