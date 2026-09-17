# Judges' host: the zero-dependency server, the officer's files, the frozen snapshot and the agenda fixture. Nothing to install.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY api api
COPY fixtures fixtures
COPY public public
COPY scripts/dev.mjs scripts/dev.mjs
ENV HOST=0.0.0.0 CREW_API=0 NODE_ENV=production
USER node
CMD ["node", "scripts/dev.mjs"]
