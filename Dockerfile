# Stage 1: Build the application
FROM node:18 AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Stage 2: Create the production image
FROM node:18-alpine
WORKDIR /app

# Устанавливаем корневые сертификаты для HTTPS
RUN apk add --no-cache ca-certificates && update-ca-certificates

# Копируем node_modules и package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Копируем все исходные файлы (включая utils.js, server.js и др.)
COPY --from=build /app/. ./

EXPOSE 3000
CMD ["npm", "start"]
