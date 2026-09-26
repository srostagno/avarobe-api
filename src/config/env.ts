import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

loadDotenv()

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  MONGODB_URI: z.string().min(1),
  // Avarobe shares the Atlas cluster with other apps; refusing any other
  // database name stops a copied .env from writing into theirs.
  MONGODB_DB: z
    .string()
    .regex(/^avarobe(_[a-z0-9]+)?$/, 'must be an Avarobe database (avarobe, avarobe_dev), never another app'),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(60),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  CORS_ORIGINS: z.string().default('http://localhost:3100'),
  // Public URL of the web app, used to build sign-in links.
  APP_URL: z.string().url().default('http://localhost:3100'),
  // Public URL of this API, used to build signed media URLs (local storage).
  API_PUBLIC_URL: z.string().url().default('http://localhost:4100'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  OPENAI_API_KEY: z.string().optional(),
  AI_TEXT_MODEL: z.string().default('gpt-5.4-mini'),
  AI_TEXT_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  AI_IMAGE_MODEL: z.string().default('gpt-image-2'),
  AI_IMAGE_QUALITY: z.enum(['low', 'medium', 'high']).default('medium'),
  // Piece photos only feed store search, so a cheaper model does: measured
  // Sep 26 at $0.013 and 12 s each vs $0.065 and 33 s with gpt-image-2.
  AI_PIECE_MODEL: z.string().default('gpt-image-1-mini'),
  AI_PIECE_QUALITY: z.enum(['low', 'medium', 'high']).default('medium'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_PREFIX: z.string().default(''),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  // Passkeys are bound to this domain. Defaults to APP_URL's hostname
  // (avarobe.com in production, localhost in development).
  WEBAUTHN_RP_ID: z.string().optional(),
  MAILERSEND_API_KEY: z.string().optional(),
  MAILERSEND_FROM_EMAIL: z.string().optional(),
  MAILERSEND_FROM_NAME: z.string().default('Avarobe'),
  // Development only: addresses that receive real email (comma-separated).
  EMAIL_DEV_ALLOWLIST: z.string().default(''),
  VERIFY_EMAIL_TTL: z.string().default('24h'),
  PASSWORD_RESET_TTL: z.string().default('1h'),
  // Cost guards: generations per user per UTC day.
  DAILY_AVATAR_LIMIT: z.coerce.number().int().min(1).max(100).default(8),
  DAILY_LOOK_LIMIT: z.coerce.number().int().min(1).max(500).default(12),
  // Looks broken down into separate piece photos, and store searches.
  DAILY_PIECES_LIMIT: z.coerce.number().int().min(1).max(100).default(6),
  DAILY_SHOP_SEARCH_LIMIT: z.coerce.number().int().min(1).max(1000).default(60),
  // SerpApi runs the Google Lens searches behind "Find it in stores".
  SERPAPI_API_KEY: z.string().optional(),
  // Billing (Stripe Checkout, one-time payments). Products and prices are
  // created in Stripe on first use, found again by lookup key.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STYLE_KIT_PRICE_CENTS: z.coerce.number().int().min(100).default(2999),
  STYLE_KIT_CREDITS: z.coerce.number().int().min(1).default(30),
  STYLE_KIT_DAYS: z.coerce.number().int().min(1).default(60),
  TOP_UP_PRICE_CENTS: z.coerce.number().int().min(100).default(999),
  TOP_UP_CREDITS: z.coerce.number().int().min(1).default(20),
  TOP_UP_DAYS: z.coerce.number().int().min(1).default(30),
  // Free allowance: looks on sign-up, and avatar renders (create + one redo).
  FREE_CREDITS: z.coerce.number().int().min(0).default(1),
  FREE_AVATAR_RUNS: z.coerce.number().int().min(1).default(2),
  // Accounts with the Style Kit for free, e.g. the founder and testers.
  COMP_EMAILS: z.string().default(''),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error(
    'Invalid environment variables:',
    parsed.error.flatten().fieldErrors,
  )
  throw new Error('Invalid environment configuration for avarobe-api.')
}

const raw = parsed.data

function optionalTrimmed(value: string | undefined) {
  const trimmed = value?.trim()

  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

const appUrl = new URL(raw.APP_URL)
const corsOrigins = raw.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

export const env = {
  ...raw,
  APP_URL: raw.APP_URL.replace(/\/+$/, ''),
  API_PUBLIC_URL: raw.API_PUBLIC_URL.replace(/\/+$/, ''),
  COOKIE_DOMAIN: optionalTrimmed(raw.COOKIE_DOMAIN),
  COOKIE_SECURE:
    raw.COOKIE_SECURE !== undefined
      ? raw.COOKIE_SECURE === 'true'
      : raw.NODE_ENV === 'production',
  CORS_ORIGINS: corsOrigins,
  WEBAUTHN_RP_ID: optionalTrimmed(raw.WEBAUTHN_RP_ID) ?? appUrl.hostname,
  WEBAUTHN_ORIGINS: [...new Set([appUrl.origin, ...corsOrigins])],
  OPENAI_API_KEY: optionalTrimmed(raw.OPENAI_API_KEY),
  S3_BUCKET: optionalTrimmed(raw.S3_BUCKET),
  S3_REGION: optionalTrimmed(raw.S3_REGION),
  MAILERSEND_API_KEY: optionalTrimmed(raw.MAILERSEND_API_KEY),
  MAILERSEND_FROM_EMAIL: optionalTrimmed(raw.MAILERSEND_FROM_EMAIL),
  EMAIL_DEV_ALLOWLIST: raw.EMAIL_DEV_ALLOWLIST.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0),
}

if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
  throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET and S3_REGION.')
}
