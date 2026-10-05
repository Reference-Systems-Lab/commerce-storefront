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

## Git hooks

Run `.githooks/setup` once after cloning. It turns on the committed hooks, which use
[git-secrets](https://github.com/awslabs/git-secrets#installing-git-secrets) to refuse any commit
that contains a secret.

## Status

Planning. No code yet.

## License

[MIT](LICENSE)
