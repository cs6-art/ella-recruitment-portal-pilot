FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY server ./server
COPY shared ./shared

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
