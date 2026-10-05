# OdarisMC Store

Vercel-native Minecraft store for OdarisMC.

## Payment and automatic delivery

The store now supports:

- Stripe Checkout for one-time product purchases.
- Minecraft username collection before payment.
- Stripe webhook verification using `STRIPE_WEBHOOK_SECRET`.
- Idempotent order delivery protection using a database lock and delivered status.
- Automatic Pterodactyl console commands after Stripe confirms payment.
- Delivery retry support when Pterodactyl is temporarily unavailable.
- Admin product creation with price, category and Minecraft commands.
- Recent order and delivery status visibility in the admin page.
- Optional Discord order notifications.

The delivery command can use `{player}`, for example:

```
lp user {player} parent set vip
```

The store replaces `{player}` with the Minecraft username entered at checkout.

## Vercel environment variables

Required:

- `DATABASE_URL` — Neon PostgreSQL connection string.
- `AUTH_SECRET` — long random session secret.
- `ADMIN_EMAIL` — owner/admin email.
- `ADMIN_PASSWORD` — owner/admin password.
- `NEXT_STORE_URL` — deployed Vercel store URL.
- `STRIPE_SECRET_KEY` — Stripe Sandbox/Test secret key.
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret.
- `PTERODACTYL_URL` — Pterodactyl panel URL.
- `PTERODACTYL_API_KEY` — Pterodactyl client API key with permission to send server commands.
- `PTERODACTYL_SERVER_ID` — the Pterodactyl server identifier used for delivery.

Optional:

- `NEXT_PUBLIC_STORE_NAME` — defaults to OdarisMC.
- `NEXT_PUBLIC_STORE_URL` — compatibility fallback for the store URL.
- `DISCORD_WEBHOOK_URL` — optional Discord notification webhook.

Never commit real secrets to GitHub and never put private API keys in `NEXT_PUBLIC_` variables.

## Stripe webhook

After the Vercel deployment is live, create a Stripe Sandbox webhook destination pointing to:

```
https://YOUR-STORE-DOMAIN/api/stripe/webhook
```

Enable:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Copy the endpoint's signing secret into Vercel as `STRIPE_WEBHOOK_SECRET`.

Stripe Checkout is created server-side and the browser success page does not grant the item. Delivery is performed only after the signed Stripe webhook confirms payment.

## Minecraft delivery

The Pterodactyl server receives each configured product command through its client server-command API. If delivery fails, the order is marked `delivery_failed` and Stripe receives an error response so the webhook can be retried.

## Local/production setup

1. Import the repository into Vercel.
2. Add the environment variables.
3. Redeploy after changing environment variables.
4. Log in to `/login` with the configured admin email/password.
5. Open `/admin` and create a product.
6. Set the product's Minecraft command(s), one per line.
7. Create the Stripe Sandbox webhook after deployment.
8. Test checkout with Stripe's official test payment details.
9. Verify the order reaches `delivered` and the command is executed by the Pterodactyl server.

The current implementation uses INR for Stripe Checkout amounts because the OdarisMC store is configured in Indian rupees.
