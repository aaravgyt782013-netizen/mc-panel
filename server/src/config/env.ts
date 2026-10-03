import "dotenv/config";

const positiveInt = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(name + " must be a positive integer");
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.HOST ?? "127.0.0.1",
  port: positiveInt("PORT", 3000),
  panelOrigin: process.env.PANEL_ORIGIN ?? "http://localhost:5173",
  sessionTtlHours: positiveInt("SESSION_TTL_HOURS", 24),
  setupTokenTtlMinutes: positiveInt("SETUP_TOKEN_TTL_MINUTES", 15),
  databasePath: process.env.DATABASE_PATH ?? "./server/data/panel.db",
  minecraftRoot: process.env.MINECRAFT_ROOT ?? "/srv/minecraft",
  minecraftUser: process.env.MINECRAFT_USER ?? "minecraft",
  maxRamMb: positiveInt("MAX_RAM_MB", 6144),
  cookieSecure: true
};
