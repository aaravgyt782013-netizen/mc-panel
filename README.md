# OdarisMC Store

Vercel-native Minecraft store for OdarisMC.

## Payment and automatic delivery

The store uses a UPI-first Razorpay Checkout flow:

- Razorpay Standard Checkout with INR orders.
- UPI is available when enabled for the merchant account, along with other payment methods enabled in Razorpay.
- Minecraft username collection before payment.
- Server-side Razorpay order creation.
- Signed Razorpay webhook verification.
- Server-side verification of the paid order amount and currency.
- Idempotent delivery protection using a database lock and delivered status.
- Automatic Minecraft commands after Razorpay confirms the payment.
- Delivery failure is recorded instead of granting from the browser success page.
- Optional Discord order notifications.

Razorpay documents real-time webhooks for payment transactions and recommends validating webhook HMAC signatures. The store listens for `order.paid`.

The delivery command can use `{player}`, for example:

```
lp user {player} parent set vip
```

## Vercel environment variables

Required:

- `DATABASE_URL` — Neon PostgreSQL connection string.
- `AUTH_SECRET` — long random session secret.
- `ADMIN_EMAIL` — owner/admin email.
- `ADMIN_PASSWORD` — owner/admin password.
- `NEXT_STORE_URL` — deployed Vercel store URL.
- `RAZORPAY_KEY_ID` — Razorpay key ID.
- `RAZORPAY_KEY_SECRET` — Razorpay key secret.
- `RAZORPAY_WEBHOOK_SECRET` — secret configured for the Razorpay webhook.
- `PTERODACTYL_URL` — Pterodactyl-compatible panel/API URL.
- `PTERODACTYL_API_KEY` — server API key.
- `PTERODACTYL_SERVER_ID` — server identifier.

Optional:

- `NEXT_PUBLIC_STORE_NAME` — defaults to OdarisMC.
- `NEXT_PUBLIC_STORE_URL` — compatibility fallback.
- `DISCORD_WEBHOOK_URL` — optional Discord notification webhook.

Never commit real secrets to GitHub and never put private keys in `NEXT_PUBLIC_` variables.

## Razorpay webhook

After the Vercel deployment is live, create a Razorpay webhook pointing to:

```
https://YOUR-STORE-DOMAIN/api/razorpay/webhook
```

Set a strong webhook secret and enable the successful order event:

- `order.paid`

The webhook secret must match `RAZORPAY_WEBHOOK_SECRET`.

Razorpay's dashboard supports webhook configuration under Settings → Webhooks. The webhook must be validated server-side before an order is delivered.

## Minecraft delivery

The store sends each configured product command to the configured server API. If delivery fails, the order is marked `delivery_failed` so it is not falsely shown as delivered.

## Setup

1. Import the repository into Vercel.
2. Add the environment variables.
3. Redeploy after changing environment variables.
4. Log in to `/login`.
5. Open `/admin` and create a product.
6. Set the product's Minecraft command(s), one per line.
7. Create the Razorpay webhook after deployment.
8. Test with Razorpay test mode before accepting live payments.
9. Verify the order reaches `delivered` and the command executes on the Minecraft server.

Use Razorpay's official dashboard/docs for current payment-method availability, onboarding, KYC and settlement requirements.
