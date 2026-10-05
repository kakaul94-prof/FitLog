# E2E test runner image.
#
# Microsoft's official Playwright image: Ubuntu + Node + the browsers and every
# OS library they need, so tests run identically on any machine and in CI.
# The tag MUST match the exact @playwright/test version in package.json;
# a mismatch fails at launch with "Executable doesn't exist".
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# Dependencies first: this layer is cached until package*.json changes, so
# editing a test only re-copies the source (seconds, not a full npm ci).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The config starts the Vite dev server itself, then runs every project.
CMD ["npx", "playwright", "test"]
