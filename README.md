# storefront

The product: the public face of the business at `rsl-commerce.test`, covering marketing,
discovery and buying. Everything else in the platform exists to support it.

## Responsibilities

- Marketing pages: the home page, landing pages and campaigns
- Promotions, shown as the backend prices them
- Newsletter signup
- Search engine visibility: product and category pages that search engines can index
- Catalog, categories, product pages and variants
- Search
- Inventory state
- Customer accounts
- The cart, and starting a checkout
- Order history
- Subscription management
- Live updates: order status, inventory, payment and subscription changes
- Product analytics events, sent through a layer that can be switched off or mocked locally

## Does not own

- Prices, discounts and totals. The backend decides them; the storefront displays them.
- Running campaigns and promotions. Staff do that in admin.
- Payment entry. The storefront hands the customer over to checkout.
- Components and design tokens. Those come from the design system.
- Any direct access to the database, cache or message broker.

## Works with

- **backend.** The storefront uses the API through the generated SDK, and gets live updates over
  WebSocket.
- **design-system.** It supplies the components, tokens and shared tooling.
- **checkout.** The storefront starts a checkout session and sends the customer there.

## Getting started

You need Node 24 and Docker. Everything else (hadolint, actionlint, Grype, Postgres, the backend,
the browsers) runs in pinned containers.

Our packages come from GitHub Packages, which needs a token even to read. Create a classic personal
access token with **only** `read:packages` and an expiry, and put it in `~/.npmrc` (not in this
repository's `.npmrc`):

```ini
//npm.pkg.github.com/:_authToken=ghp_your_token
```

Don't use `gh auth token`: it carries `repo`. The scripts also accept the token as
`NODE_AUTH_TOKEN`, which is how CI passes its own.

```sh
npm ci          # the hardened install: no install scripts, packages at least 7 days old
make backend    # Postgres and the backend v0.1.0, seeded, on 127.0.0.1:18080
NUXT_API_BASE_URL=http://127.0.0.1:18080 npm run dev
make lint       # every static check CI runs
make test       # unit tests with coverage thresholds
make fragment   # build the image, run it hardened, then run it the way the platform does
make help       # all the targets
```

`make fragment` runs the whole stack in containers:

- Postgres, and the backend's own fragment at its release;
- this repository's `compose.platform.yaml`;
- the header check and Playwright in Chromium, Firefox and WebKit, run from a container that shares
  the storefront's network.

## Configuration

| Variable                 | Meaning                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_API_BASE_URL`      | The backend API's address, read only on the server; the platform sets it from `STOREFRONT_API_BASE_URL` (`http://backend-api:8080` on `edge`) |
| `NITRO_PORT`             | The port; 3000 in the image                                                                                                                   |
| `NITRO_SHUTDOWN_TIMEOUT` | How long a stop drains open requests; 10000 ms in the image                                                                                   |

The browser never calls the API. `/` is prerendered with no scripts; `/products` is rendered on
every request and never cached.

## Running on the platform

The platform includes `compose.platform.yaml` at a release commit, with its own wiring file. That
file pins the image digest and puts `storefront-web` on `edge`; the platform's proxy serves it at
`https://rsl-commerce.test`. The fragment sets no image, ports or networks, and requires
`STOREFRONT_API_BASE_URL`. Neither its health check nor the home page needs the backend.

## Releasing

Publish a GitHub release tagged `vX.Y.Z` on a commit on `main`:

```sh
gh release create vX.Y.Z --generate-notes
```

The release workflow then runs these steps, stopping at the first failure:

1. It checks the tag and that its commit is on `main`.
2. It scans every installed package and the image with Grype, stopping on any high finding.
3. It pushes `ghcr.io/reference-systems-lab/commerce-storefront:X.Y.Z` for amd64 and arm64, with an
   SBOM and a signed build-provenance attestation.

A rerun never pushes a version that is already on GHCR. Every pull request rehearses the build
(`make rehearse`): both platforms, with the SBOM and provenance, and no token in any layer. The first
release creates a private package, which must be made public once (it can't be made private again).

## Verifying

- **Our packages:** `sh scripts/verify-packages.sh` checks each `@reference-systems-lab` tarball
  against the lockfile, the registry and its attestation.
- **The image:**

  ```sh
  gh attestation verify oci://ghcr.io/reference-systems-lab/commerce-storefront@<digest> \
    --owner Reference-Systems-Lab \
    --signer-workflow Reference-Systems-Lab/commerce-storefront/.github/workflows/release.yml
  ```

## Pins bumped by hand

Dependabot leaves two pairs alone, and `make lint` checks that each pair agrees:

- **The backend:** the commit in `ci/compose.stub.yaml`'s include, and the image tag in
  `ci/compose.backend.yaml`. The commit must be the commit of that release.
- **Playwright:** the image in `ci/compose.browser.yaml`, and `@playwright/test` in the lockfile.

Two images that workflows hand to actions aren't seen by Dependabot either, so they're bumped by hand
(`make lint` checks they're pinned by digest): BuildKit's builder in `release.yml`, and QEMU's
binfmt in `ci.yml`.

## Decisions

- [ADR 0001: The storefront's stack](docs/adr/0001-storefront-stack.md)

## Git hooks

Run `.githooks/setup` once after cloning. It turns on the committed hooks, which use
[git-secrets](https://github.com/awslabs/git-secrets#installing-git-secrets) to refuse any commit
that contains a secret.

## Status

The walking skeleton: a prerendered home page and the products page, rendered through the SDK, plus
the image, the fragment and the release. The other pages follow.

## License

[MIT](LICENSE)
