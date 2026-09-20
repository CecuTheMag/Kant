FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --ignore-scripts && npm run build
CMD ["node", "dist/index.js"]
