# OdarisMC Store

Vercel-native Minecraft store replacing the old mc-panel contents.

Foundation: Next.js, customer/admin authentication, PostgreSQL/Neon database, products, orders, Minecraft usernames, Discord webhook integration, Pterodactyl delivery integration point and Stripe dependency.

Deploy from Android: import the repo into Vercel and add variables from .env.example. Use a free PostgreSQL provider such as Neon for DATABASE_URL. Never put secrets in NEXT_PUBLIC_ variables.