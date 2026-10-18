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
  // How a color read finds the season (modules/avatar/measure.ts): 'scored'
  // measures four traits with fixed settings and derives the season in code,
  // then writes the palette for it; 'classic' asks the model for the whole
  // read at once, and then an existing season never changes by itself.
  // Classic by default: on 11-Oct-2026 the scored read gave 2 of 4
  // fictional faces the same season 3 times out of 3 and one 3 different
  // seasons, 83% of reads were close calls (evals/colors/consistency.ts).
  COLOR_READ_METHOD: z.enum(['scored', 'classic']).default('classic'),
  // The measuring call is pinned to the model it was tested with (Oct 2026),
  // not to AI_TEXT_MODEL.
  COLOR_MEASURE_MODEL: z.string().default('gpt-5.4-mini'),
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
  // Before they pay, their best color on their face stays locked (blurred);
  // only the worst one shows. 'off' gives both away free again.
  LOCK_BEST_COLOR: z.enum(['on', 'off']).optional(),
  // The free preview: their three best colors and their worst on their face
  // (a 2x2 grid, the best three locked until they pay). 'off' goes back to
  // the best-and-worst pair.
  BEST_COLORS_GRID: z.enum(['on', 'off']).optional(),
  // Postal address for the footer of promotional emails (CAN-SPAM). The
  // upgrade offer and its reminders only go out once it is set.
  EMAIL_POSTAL_ADDRESS: z.string().optional(),
  // Cross-sell emails lead with a picture made for each buyer, from her own
  // avatar (lifecycle/assets.ts). 'off' sends every one with its stock
  // picture. At most this many new pictures start per run (every 10
  // minutes), so a backlog can't run up the image bill.
  XSELL_PERSONAL_IMAGES: z.enum(['on', 'off', 'true', 'false']).optional(),
  XSELL_IMAGE_STARTS_PER_RUN: z.coerce.number().int().min(0).max(50).default(4),
  VERIFY_EMAIL_TTL: z.string().default('24h'),
  PASSWORD_RESET_TTL: z.string().default('1h'),
  // Sign-in links: from an in-app browser (Instagram, Facebook) to the phone's
  // own browser, and in the email that brings back an unfinished checkout.
  HANDOFF_LINK_TTL: z.string().default('15m'),
  SIGN_IN_LINK_TTL: z.string().default('3d'),
  // The sign-in links in our emails (auth-links.ts emailLink): they work
  // this long, as often as needed and in any browser.
  EMAIL_LINK_TTL: z.string().default('14d'),
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
  // Safety cap (Oct 2026): new AI pictures per account per UTC day across
  // looks, try-ons, events, hairstyles, avatar renders and color checks (not
  // color reads, report boards, magazines or piece photos). It only delays:
  // credits are never spent on a picture it stops. Comp accounts are exempt.
  AI_DAILY_IMAGE_LIMIT: z.coerce.number().int().min(1).max(500).default(15),
  // SerpApi runs the Google Lens searches behind "Find it in stores".
  SERPAPI_API_KEY: z.string().optional(),
  // Billing (Stripe Checkout). Products and prices are created in Stripe on
  // first use and found again by lookup key; a new amount gets a new price.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // The price list (US cents). The reports are one-time and yours to keep;
  // the look pack never expires; Pro is a subscription, monthly or annual.
  // Pro includes both reports while it lasts; the annual plan keeps them.
  // Cut on 2-Oct-2026 from $14.90 / $9.90 / $19.90 / $9.90 / $10.90 / $59.90:
  // no purchases in the report-first offer's first 48 sign-ups, and "too
  // expensive" was 65% of the reasons given. Review on 7-Oct.
  PRICE_COLOR_REPORT_CENTS: z.coerce.number().int().min(100).default(499),
  PRICE_STYLE_REPORT_CENTS: z.coerce.number().int().min(100).default(790),
  PRICE_REPORTS_BUNDLE_CENTS: z.coerce.number().int().min(100).default(1190),
  PRICE_LOOK_PACK_CENTS: z.coerce.number().int().min(100).default(499),
  // The color mirror, on its own (2-Oct-2026).
  PRICE_COLOR_MIRROR_CENTS: z.coerce.number().int().min(100).default(990),
  // The advisors split (Oct 2026): Hair & Grooming on its own, the three
  // advisors together, and one event with the Event Stylist.
  PRICE_HAIR_ADVISOR_CENTS: z.coerce.number().int().min(100).default(790),
  PRICE_ADVISORS_BUNDLE_CENTS: z.coerce.number().int().min(100).default(1990),
  PRICE_EVENT_CENTS: z.coerce.number().int().min(100).default(490),
  // The personal magazine (4-Oct-2026): ten looks on location, its photos made
  // with this model and quality.
  PRICE_MAGAZINE_CENTS: z.coerce.number().int().min(100).default(990),
  MAGAZINE_IMAGE_MODEL: z.string().default('gpt-image-2.5-sunburst'),
  MAGAZINE_IMAGE_QUALITY: z.enum(['low', 'medium', 'high']).default('high'),
  // The Outfit Formula Book (PDF), and where the server finds the file.
  PRICE_OUTFIT_GUIDE_CENTS: z.coerce.number().int().min(100).default(1490),
  // One teaser unlocked without Pro (teasers): the downsell under Pro.
  PRICE_TEASER_UNLOCK_CENTS: z.coerce.number().int().min(100).default(199),
  OUTFIT_GUIDE_PDF: z.string().default('assets/products/outfit-formula-book.pdf'),
  LOOK_PACK_CREDITS: z.coerce.number().int().min(1).default(10),
  PRICE_PRO_MONTHLY_CENTS: z.coerce.number().int().min(100).default(799),
  PRICE_PRO_ANNUAL_CENTS: z.coerce.number().int().min(100).default(2999),
  PRO_MONTHLY_CREDITS: z.coerce.number().int().min(1).default(30),
  // Avatar renders per Pro month (create, update, adjust, a haircut on the
  // avatar), from Oct 2026; unlimited before.
  PRO_AVATAR_RUNS_PER_MONTH: z.coerce.number().int().min(1).max(500).default(20),
  // Subscriptions paid before the cap shipped keep unlimited avatar renders
  // until their next payment (Pro payments from then on are marked
  // pro.avatarCap). 'off' applies the cap to everyone right away.
  PRO_AVATAR_GRANDFATHER: z.enum(['on', 'off']).optional(),
  // Pro annual's first payment: this many looks right away, the rest of the
  // month's PRO_MONTHLY_CREDITS after PRO_ANNUAL_FIRST_WEEK_DAYS. Renewals and
  // the switch from monthly get the whole month at once. A value at or above
  // PRO_MONTHLY_CREDITS turns the hold off.
  PRO_ANNUAL_FIRST_WEEK_CREDITS: z.coerce.number().int().min(0).default(10),
  PRO_ANNUAL_FIRST_WEEK_DAYS: z.coerce.number().int().min(1).max(31).default(7),
  // Unused looks roll over up to this many (from Oct 2026; no cap before).
  // Renewals and each month's looks add only what fits under it, and a
  // balance already above it is kept, with nothing added. A subscription's
  // first payment (and the rest of annual's first month) and look packs
  // always add in full.
  PRO_ROLLOVER_CAP: z.coerce.number().int().min(1).default(60),
  // Subscriptions paid before the cap shipped get their next payment's looks
  // (and, on annual, every month's looks until then) in full; payments from
  // then on mark pro.rolloverCap and the cap applies after that one, as the
  // Terms say. 'off' applies the cap to everyone right away.
  PRO_ROLLOVER_GRANDFATHER: z.enum(['on', 'off']).optional(),
  // The Pro credit in the cross-sell emails leaves out buyers of the three
  // advisors together (their bundle costs more than the credit can count):
  // 'on' by default, 'off' offers it to them too.
  PRO_CREDIT_EMAIL_SKIP_ADVISORS_BUNDLE: z.enum(['on', 'off']).optional(),
  // Under that credit, a link to the web's Pro tour ("See what Pro does ·
  // 1 min", /studio?see=pro) for whom the web plays it: 'on' by default,
  // 'off' leaves it out (the tour turned off on the web).
  PRO_TOUR_EMAIL_LINK: z.enum(['on', 'off']).optional(),
  // The first-time offer: Pro for a few days at a small price, then monthly.
  // One trial per account, with fewer looks than a paid month.
  PRICE_PRO_TRIAL_CENTS: z.coerce.number().int().min(50).default(100),
  PRO_TRIAL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  PRO_TRIAL_CREDITS: z.coerce.number().int().min(1).default(10),
  // Whether new accounts are offered the trial. Off since 1-Oct-2026: the
  // Color Advisor leads, with Pro monthly after it ('on' brings the trial back;
  // trials already running are unaffected either way).
  PRO_TRIAL: z.enum(['on', 'off']).optional(),
  // For this many days after buying a report, it counts toward the other
  // report (the bundle price) and toward Pro annual.
  REPORT_CREDIT_WINDOW_DAYS: z.coerce.number().int().min(1).default(14),
  // Free allowance. New accounts get SIGNUP_CREDITS looks, stored on the
  // account (one drawn look; the stylist designs two more, locked).
  // FREE_CREDITS is what accounts from before that have without a stored
  // number. Plus avatar renders (create + one redo).
  SIGNUP_CREDITS: z.coerce.number().int().min(0).default(1),
  // Trying before an account (guests): how long an unsaved guest is kept,
  // and how many can start in a day (each selfie costs an AI read).
  GUEST_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  // Face Age (modules/look): face photos read without Pro (her first
  // selfie and a couple of old photos, enough for a timeline), the day's
  // cap for everyone, and the years taken off the model's estimate, which
  // leans old on older women (NIST IR 8525, 2024). Re-measure the lean from
  // real ages once enough have joined (look/age.ts).
  LOOK_FREE_PHOTOS: z.coerce.number().int().min(0).default(3),
  LOOK_DAILY_PHOTOS: z.coerce.number().int().min(1).default(20),
  LOOK_AGE_OFFSET: z.coerce.number().min(-10).max(10).default(-2),
  // The one-time email announcing Face Age to everyone without Pro: 'on' sends
  // it in their daytime, a batch every run, until everyone has it.
  FACE_AGE_LAUNCH: z.enum(['on', 'off']).optional(),
  // Rough dollars per real and per peso, only for the admin's revenue totals
  // (billing/pricing.ts); Stripe does the real conversion.
  FX_USD_PER_BRL: z.coerce.number().positive().default(0.18),
  FX_USD_PER_MXN: z.coerce.number().positive().default(0.055),
  FX_USD_PER_COP: z.coerce.number().positive().default(0.00025),
  GUEST_DAILY_LIMIT: z.coerce.number().int().min(0).default(2000),
  FREE_CREDITS: z.coerce.number().int().min(0).default(3),
  FREE_AVATAR_RUNS: z.coerce.number().int().min(1).default(2),
  // Hairstyles rendered free: the ideal cut from the hair read. The rest of
  // the recommendations come with the Style Advisor or Pro.
  FREE_HAIR_RUNS: z.coerce.number().int().min(0).default(1),
  // Collection looks (an Edit's or an icon look) tried on without Pro, so
  // they see themselves in one before the offer (Halloween flow, Oct 2026).
  FREE_TRY_ONS: z.coerce.number().int().min(0).default(1),
  // Face · Looks · Hair (Oct 17, 2026; Silvio: the three studios work alike,
  // each with a score and a try-on). Each part can be turned off ('off':
  // its routes answer 404 and the web hides it).
  SCORES_ENABLED: z.enum(['on', 'off']).default('on'),
  MAKEUP_ENABLED: z.enum(['on', 'off']).default('on'),
  HAIR_PRESETS_ENABLED: z.enum(['on', 'off']).default('on'),
  // Free without Pro, per studio, ever: Look Score and Hair Score photos
  // (each), makeup presets tried on, hair presets tried on.
  SCORE_FREE_PHOTOS: z.coerce.number().int().min(0).default(3),
  FREE_MAKEUP_TRY_ONS: z.coerce.number().int().min(0).default(1),
  FREE_HAIR_PRESETS: z.coerce.number().int().min(0).default(1),
  // The day's fair-use caps: score reads (looks and hair together) and
  // makeup renders (which also count toward AI_DAILY_IMAGE_LIMIT).
  DAILY_SCORE_LIMIT: z.coerce.number().int().min(1).max(200).default(20),
  DAILY_MAKEUP_LIMIT: z.coerce.number().int().min(1).max(200).default(20),
  // The score's measuring call (modules/scores): pinned to the model it was
  // calibrated with, reasoning none and temperature 0, in English; SAMPLES
  // measures run at once and are averaged. The score is computed in code
  // from them: OFFSET moves every score, FLOOR is the lowest shown (honest,
  // never cruel). Recalibrate with evals/scores before changing any.
  SCORE_MEASURE_MODEL: z.string().default('gpt-5.4-mini'),
  // Calibrated Oct 17 (evals/scores, rubric scores-2026-10-17b): one sample
  // held as steady as two, and -7 puts everyday photos at about 60–75
  // (poor ~40, excellent ~85). The same photo again never moves: it returns
  // its read.
  SCORE_SAMPLES: z.coerce.number().int().min(1).max(3).default(1),
  SCORE_OFFSET: z.coerce.number().min(-30).max(30).default(-7),
  SCORE_FLOOR: z.coerce.number().int().min(1).max(60).default(35),
  // Accounts with everything for free, e.g. the founder and testers.
  COMP_EMAILS: z.string().default(''),
  // Who gets the operations alerts (OpenAI out of credits, color reads
  // failing), comma-separated. COMP_EMAILS when empty, testers included.
  ALERT_EMAILS: z.string().default(''),
  // Refund requests (billing/refund-requests.ts): who gets each new request
  // and the reminders, comma-separated. The first address is also the
  // reply-to of the customer's refund emails.
  REFUNDS_EMAIL: z.string().default('hello@avarobe.com'),
  // When the Terms with reviewed refunds went live (the web's deploy).
  // Purchases paid before it keep the old guarantee: their requests are
  // flagged old_guarantee for the founder.
  REFUND_TERMS_SINCE: z.coerce.date().default(new Date('2026-10-13T00:00:00Z')),
  // Development only: every OpenAI call fails this way (utils/openai.ts),
  // to try the busy state, the retries and the alerts. Ignored in production.
  AI_FAULT: z.enum(['no_credits', 'rate_limit', 'server', 'timeout', 'rejected']).optional(),
  // How often failed color reads with a "tell me when ready" request are
  // tried again (modules/avatar/retry.ts).
  COLOR_RETRY_EVERY_MS: z.coerce.number().int().min(10_000).default(300_000),
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
  LOCK_BEST_COLOR: (raw.LOCK_BEST_COLOR ?? 'on') === 'on',
  BEST_COLORS_GRID: (raw.BEST_COLORS_GRID ?? 'on') === 'on',
  PRO_TRIAL: (raw.PRO_TRIAL ?? 'off') === 'on',
  FACE_AGE_LAUNCH: (raw.FACE_AGE_LAUNCH ?? 'off') === 'on',
  PRO_AVATAR_GRANDFATHER: (raw.PRO_AVATAR_GRANDFATHER ?? 'on') === 'on',
  PRO_ROLLOVER_GRANDFATHER: (raw.PRO_ROLLOVER_GRANDFATHER ?? 'on') === 'on',
  PRO_CREDIT_EMAIL_SKIP_ADVISORS_BUNDLE: (raw.PRO_CREDIT_EMAIL_SKIP_ADVISORS_BUNDLE ?? 'on') === 'on',
  PRO_TOUR_EMAIL_LINK: (raw.PRO_TOUR_EMAIL_LINK ?? 'on') === 'on',
  EMAIL_POSTAL_ADDRESS: optionalTrimmed(raw.EMAIL_POSTAL_ADDRESS),
  AI_FAULT: raw.NODE_ENV === 'production' ? undefined : raw.AI_FAULT,
  XSELL_PERSONAL_IMAGES: ['on', 'true'].includes(raw.XSELL_PERSONAL_IMAGES ?? 'on'),
  EMAIL_DEV_ALLOWLIST: raw.EMAIL_DEV_ALLOWLIST.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0),
  REFUNDS_EMAIL: raw.REFUNDS_EMAIL.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0),
}

if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
  throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET and S3_REGION.')
}
