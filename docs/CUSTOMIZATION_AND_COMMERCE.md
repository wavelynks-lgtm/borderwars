# Flags, patterns, generated worlds, and monetization

## Appearance

Choose **Customize** next to your commander name. The picker includes region flags, star/crown/globe emblems, territory and pattern colors, and six patterns. Solid, stripes and dots are free. Checks, chevrons, crosshatch and the Supporter badge are included in Supporter. Flags appear on map nameplates and the in-match leaderboard; the surface shader patterns only the current owner's land, leaving defensive borders, fallout and targeting cues readable. Motifs use spherical coordinates and fade when smaller than a pixel. Emoji flags depend on operating-system font support.

Solo preferences are saved on the device. Signed-in players save appearance to the account; the match server verifies premium access before copying appearance into a lobby. Duplicate online colors are reassigned so opponents remain distinguishable. Appearance changes apply to the next match. No paid product changes troops, income, combat, ranges, leaderboard placement, or matchmaking.

## World Forge

Open **World Forge** from the main menu. Controls include three land layouts (continents, archipelago, supercontinent), four world themes, seed, water coverage, continent scale, coastline detail, mountains, polar ice, country count, country tint, five colors, and 1024/2048/4096-wide resolution. The preview is generated from the selected recipe; changing controls invalidates Play until regeneration. Work runs in a cancellable worker so the menu stays responsive.

Terrain uses domain-warped noise sampled on a sphere. Sea level is chosen from latitude-weighted surface area. Seeded country centers expand according to distance and elevation costs, producing connected mainland regions with irregular terrain-influenced borders. Unseeded islands join their nearest country. These are fictional generated worlds, not imported geography or a geological simulation.

Save up to 40 recipes locally. **Load** regenerates a saved world; **Export** downloads a versioned `.world.json` file; **Import** validates one. Files store the seed and settings, not a match save or millions of terrain cells. Clearing browser storage removes local recipes, so export worlds you want to keep. Generator version 1 must remain compatible; future algorithm changes need a new version/migration. **Play this world** starts a solo match on the generated globe. Random online matches use the shared Earth map. To host a saved world online, open **Custom Match → Create custom match** and choose it from the World picker. Worlds up to 2048px are supported; 4096px worlds remain solo-only. Custom matches are unranked.

## Store: prepared, not live

Open **Store** from the sidebar. Without configuration, offers show Coming soon and cannot take payment. The initial offers are one-time **Ad-free** and **Supporter** (ad-free + badge + premium patterns). Prices are read from your configured Stripe Prices, never invented by the browser. There is no recurring subscription.

Server configuration:

- `COMMERCE_ENABLED=true` only when ready to sell.
- `STRIPE_SECRET_KEY`: start with a Stripe test-mode secret.
- `STRIPE_WEBHOOK_SECRET`: signing secret for `/api/payments/webhook`.
- `STRIPE_PRICE_AD_FREE`, `STRIPE_PRICE_SUPPORTER`: active one-time Price IDs.
- `PUBLIC_APP_URL`: your exact HTTPS frontend origin.

Checkout requires an authenticated account and uses server-selected product/price IDs. The server reuses pending checkout sessions and uses Stripe idempotency keys. Stripe's hosted page handles payment details; this app does not collect card numbers. Register webhooks for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed`.

Webhooks validate signatures against the raw body, retrieve canonical payment state, and verify account, product, amount and currency against the stored order. A success-page visit cannot grant access. Pending payments grant nothing. Paid orders are the source of entitlements; full or partial refunds and open/lost disputes revoke access from that order. A won dispute can restore it. Duplicate and out-of-order events retrieve the current state. If an account has another valid purchase, it retains the matching entitlement. Keep server and database credentials out of all `VITE_` variables. Account recovery is still not implemented; add a recovery/support workflow before accepting live sales.

Before activation, configure your business identity, support contact, product terms/refund process, taxes and receipts in Stripe and your site. Test complete, cancelled, delayed, duplicate, refunded and disputed payments with Stripe test mode and a real webhook endpoint. The automated tests use Stripe's signature verifier and a mocked payment API; they do not replace a connected-account test. Stripe processing fees apply; preparation does not make payment processing free.

## Ads: prepared, not live

Only a menu banner slot is implemented; no ads interrupt gameplay. Set `VITE_ADS_ENABLED=true`, `VITE_ADSENSE_CLIENT`, and `VITE_ADSENSE_SLOT` after approval of your publisher account/site. Configure your provider's required `ads.txt` with your actual publisher ID; no fictitious publisher ID is shipped.

Install and configure a Google-certified CMP via your provider's official snippet. The app waits for its `__tcfapi` consent signal. It loads no ad library or ad request without consent to purposes 1, 3 and 4 and Google vendor 755, even outside regions where that stricter gate is required. It does not implement a homemade consent dialog or claim CMP certification. Refusing consent keeps the slot hidden. The CMP controls revocation and privacy choices. Ad-free accounts are checked before loading ads; if entitlement lookup fails, ads remain suppressed. The banner is removed when entering a game or signing into an ad-free account. Real ad fill, revenue, regional consent and provider approval still require live-account verification.

Vercel Hobby is restricted to non-commercial use. Before monetizing, use a commercial-compatible hosting plan or move the frontend to a suitable host. Existing free-tier deployment instructions describe a non-commercial launch, not authorization to monetize on Hobby.

Official references: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature), [Stripe refunds](https://docs.stripe.com/refunds), [Google CMP requirements](https://support.google.com/adsense/answer/13554116), [Vercel Hobby restrictions](https://vercel.com/docs/plans/hobby).
