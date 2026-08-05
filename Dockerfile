# The Playwright image ships Chromium plus every system library it needs, on a
# Node runtime new enough for the built-in `node:sqlite` module.
#
# The tag MUST match the `playwright` version resolved in package-lock.json: the
# npm package only drives the browser build that shipped with its own release.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The interface build needs its devDependencies (Vite, Tailwind, TypeScript),
# so NODE_ENV is only set to production after the build has run.
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci

COPY . .
RUN npm --prefix web run build && rm -rf web/node_modules

ENV NODE_ENV=production \
    WEB_HOST=0.0.0.0 \
    WEB_PORT=4321 \
    LINKEDIN_HEADLESS=true \
    AGENT_DATABASE_PATH=/data/agent.sqlite \
    AGENT_BROWSER_PROFILE_DIR=/data/browser-profile

# The database and the persistent LinkedIn session live on a volume.
VOLUME ["/data"]
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||4321)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/web/server.js"]
