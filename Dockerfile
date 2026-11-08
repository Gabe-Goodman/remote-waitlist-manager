# Stage 1: install everything and compile TypeScript. `tsc` type-checks
# as it compiles, so a type error fails the image build.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Stage 2: only the compiled JavaScript and production dependencies.
# No TypeScript, no dev tools, no source.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# What the pages inline for the browser: read from here at startup.
COPY browser ./browser
# Don't run as root inside the container.
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
