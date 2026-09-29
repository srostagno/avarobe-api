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
  // The stylist that plans looks: brief-following matters more than speed here.
  AI_STYLIST_MODEL: z.string().default('gpt-5.5'),
  AI_STYLIST_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
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
  // Onboarding emails (welcome and reminders). On by default in production,
  // off elsewhere unless set to 'on'.
  LIFECYCLE_EMAILS: z.enum(['on', 'off']).optional(),
  // Postal address for the footer of promotional emails (CAN-SPAM). The
  // upgrade offer and its reminders only go out once it is set.
  EMAIL_POSTAL_ADDRESS: z.string().optional(),
  VERIFY_EMAIL_TTL: z.string().default('24h'),
  PASSWORD_RESET_TTL: z.string().default('1h'),
  // Cost guards: generations per user per UTC day.
  DAILY_AVATAR_LIMIT: z.coerce.number().int().min(1).max(100).default(8),
  // Looks a day, for everyone. Credits are the real limit (and running out of
  // them is what shows the upgrade); this only stops abuse.
  DAILY_LOOK_LIMIT: z.coerce.number().int().min(1).max(500).default(40),
  // Looks broken down into separate piece photos, and store searches.
  DAILY_PIECES_LIMIT: z.coerce.number().int().min(1).max(100).default(6),
  // Writing a report renders its boards (up to 7 paid images), so rewrites are capped.
  DAILY_REPORT_LIMIT: z.coerce.number().int().min(1).max(50).default(6),
  DAILY_SHOP_SEARCH_LIMIT: z.coerce.number().int().min(1).max(1000).default(60),
  // Hair studio: reads of the selfie and hairstyle renders, per day.
  DAILY_HAIR_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  // SerpApi runs the Google Lens searches behind "Find it in stores".
  SERPAPI_API_KEY: z.string().optional(),
  // Billing (Stripe Checkout). Products and prices are created in Stripe on
  // first use and found again by lookup key; a new amount gets a new price.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // The price list (US cents). The reports are one-time and yours to keep;
  // the look pack never expires; Pro is a subscription, monthly or annual.
  // Pro includes both reports while it lasts; the annual plan keeps them.
  PRICE_COLOR_REPORT_CENTS: z.coerce.number().int().min(100).default(1490),
  PRICE_STYLE_REPORT_CENTS: z.coerce.number().int().min(100).default(990),
  PRICE_REPORTS_BUNDLE_CENTS: z.coerce.number().int().min(100).default(1990),
  PRICE_LOOK_PACK_CENTS: z.coerce.number().int().min(100).default(990),
  LOOK_PACK_CREDITS: z.coerce.number().int().min(1).default(10),
  PRICE_PRO_MONTHLY_CENTS: z.coerce.number().int().min(100).default(1090),
  PRICE_PRO_ANNUAL_CENTS: z.coerce.number().int().min(100).default(5990),
  PRO_MONTHLY_CREDITS: z.coerce.number().int().min(1).default(30),
  // The first-time offer: Pro for a few days at a small price, then monthly.
  // One trial per account, with fewer looks than a paid month.
  PRICE_PRO_TRIAL_CENTS: z.coerce.number().int().min(50).default(100),
  PRO_TRIAL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  PRO_TRIAL_CREDITS: z.coerce.number().int().min(1).default(10),
  // For this many days after buying a report, it counts toward the other
  // report (the bundle price) and toward Pro annual.
  REPORT_CREDIT_WINDOW_DAYS: z.coerce.number().int().min(1).default(14),
  // Free allowance. New accounts get SIGNUP_CREDITS looks, stored on the
  // account (one drawn look; the stylist designs two more, locked).
  // FREE_CREDITS is what accounts from before that have without a stored
  // number. Plus avatar renders (create + one redo).
  SIGNUP_CREDITS: z.coerce.number().int().min(0).default(1),
  FREE_CREDITS: z.coerce.number().int().min(0).default(3),
  FREE_AVATAR_RUNS: z.coerce.number().int().min(1).default(2),
  // Hairstyles rendered free: the ideal cut from the hair read. The rest of
  // the recommendations come with the Style Report or Pro.
  FREE_HAIR_RUNS: z.coerce.number().int().min(0).default(1),
  // Accounts with everything for free, e.g. the founder and testers.
  COMP_EMAILS: z.string().default(''),
  // Server-side purchase events (see billing/conversions.ts). The ids are
  // public; each side turns on when its secret is set.
  GA_MEASUREMENT_ID: z.string().default('G-61GY4E48S6'),
  GA_API_SECRET: z.string().optional(),
  META_PIXEL_ID: z.string().default('1124489527286755'),
  META_CAPI_TOKEN: z.string().optional(),
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
  LIFECYCLE_EMAILS: (raw.LIFECYCLE_EMAILS ?? (raw.NODE_ENV === 'production' ? 'on' : 'off')) === 'on',
  EMAIL_POSTAL_ADDRESS: optionalTrimmed(raw.EMAIL_POSTAL_ADDRESS),
  EMAIL_DEV_ALLOWLIST: raw.EMAIL_DEV_ALLOWLIST.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0),
}

if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
  throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET and S3_REGION.')
}
