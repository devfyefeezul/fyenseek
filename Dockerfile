# For hosting on any VM (for example Oracle Cloud Always Free).
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
