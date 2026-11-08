# Stage 1: install everything, compile the server's TypeScript and build the
# browser's script with Vite. `tsc` type-checks as it compiles, so a type
# error fails the image build.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json vite.config.ts ./
COPY src ./src
COPY browser ./browser
RUN npm run build

# Stage 2: only the compiled JavaScript and production dependencies.
# No TypeScript, no dev tools, no source.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The server, and the browser's script in dist/browser.
COPY --from=build /app/dist ./dist
# The page's CSS, inlined into every page: read from here at startup.
COPY browser/page.css ./browser/page.css
# Don't run as root inside the container.
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
