# The storefront image: Nuxt's .output on Chainguard's Node, with no shell and no known CVEs (ADR 0001;
# commerce-storefront#2 D-26). The output is the same on every architecture, so it's built once on the
# build machine and copied onto each platform's base, with no emulation. Build and runtime run the same
# Node. The npm token reaches only `npm ci`, as a BuildKit secret (REQ-013).
FROM --platform=$BUILDPLATFORM node:26.11.1-trixie-slim@sha256:193fe51b64e77981119c98c2002c9e32a70e2f006fb4d25068ce0558998917f0 AS install
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY docker/npmrc-auth docker/npmrc-auth
RUN --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN \
    NPM_CONFIG_USERCONFIG=docker/npmrc-auth npm ci --no-audit --no-fund

# Every installed package, development ones included, for Grype (REQ-002): build with --target deps.
FROM scratch AS deps
COPY --from=install /src/node_modules /node_modules

FROM install AS build
COPY nuxt.config.ts ./
COPY app ./app
# No network: the home page is prerendered from the app alone (REQ-005). No native modules either,
# since one built here would only suit the build machine.
RUN --network=none node_modules/.bin/nuxt build \
 && if [ -n "$(find .output -name '*.node' -print -quit)" ]; then echo 'error: .output holds a native module' >&2; exit 1; fi

FROM cgr.dev/chainguard/node:latest@sha256:140e2bda3b36b7c19ffaff951f21942d05d24cc77089cd7a9d9c91aece88a549
LABEL org.opencontainers.image.source="https://github.com/Reference-Systems-Lab/commerce-storefront" \
      org.opencontainers.image.title="commerce-storefront" \
      org.opencontainers.image.description="The commerce platform's storefront" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build /src/.output /app/.output
COPY docker/healthcheck.mjs /app/healthcheck.mjs
USER 65532:65532
# Nitro drains open requests for up to 10 s on SIGTERM, then exits 0.
ENV NITRO_PORT=3000 NITRO_SHUTDOWN_TIMEOUT=10000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=4s --start-period=10s --retries=3 CMD ["/usr/bin/node", "/app/healthcheck.mjs"]
# The base's entrypoint is /usr/bin/node.
CMD ["/app/.output/server/index.mjs"]
