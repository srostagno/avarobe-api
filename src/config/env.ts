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
  LOGIN_LINK_TTL: z.string().default('30m'),
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
  // Cost guards: generations per user per UTC day.
  DAILY_AVATAR_LIMIT: z.coerce.number().int().min(1).max(100).default(4),
  DAILY_LOOK_LIMIT: z.coerce.number().int().min(1).max(500).default(12),
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
}

if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
  throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET and S3_REGION.')
}
