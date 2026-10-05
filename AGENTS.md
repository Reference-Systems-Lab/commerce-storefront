# Agent instructions: storefront

The storefront is the public face of the business, covering marketing, discovery and buying, and it
is the primary application. Read the root
[`AGENTS.md`](../AGENTS.md) as well; this file wins where the two conflict.

## Boundaries

- Talk to the rest of the platform only through public interfaces: the API, through the generated
  SDK, and real-time events.
- Use the design system's components and tokens. Do not fork them locally; propose changes in
  `design-system` instead.
- Payment details are entered in checkout, never here.

## Rules

- Never trust the browser for anything authoritative: prices, stock or permissions.
- Analytics goes through the analytics abstraction, so it can be disabled or mocked.
- Never hand-write API types that the SDK already generates.
