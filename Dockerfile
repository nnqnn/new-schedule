# Stage 1: Build the application
FROM node:18 AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Stage 2: Create the production image
FROM node:18-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/script.js ./script.js
COPY --from=build /app/style.css ./style.css
COPY --from=build /app/index.html ./index.html
COPY --from=build /app/nginx.conf ./nginx.conf

EXPOSE 3000
CMD ["npm", "start"]
