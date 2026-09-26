# avarobe-api

Fastify backend for **Avarobe** (avarobe.com), an AI stylist: a person uploads a selfie plus height, weight, build and the clothing they shop for; we generate a full-body 2D avatar and a 12-season color analysis, then style complete outfits for an occasion and render them on the avatar. Looks are saved into collections per occasion. English, US-first.

Lives in the `Projects/Avarobe/code` workspace next to `avarobe-web` (it started inside the Trimry workspace and moved out on 2026-09-26). It shares conventions with `trimry-api` (Fastify 5, zod env, Mongo driver, JWT access cookie + rotating refresh cookie) but is its own service with its own database, cookies and domain. Product, research and operations docs live in `../../docs/`.

## Run

- `corepack pnpm --filter avarobe-api dev` (port 4100). Copy `.env.example` to `.env`.
- `corepack pnpm --filter avarobe-api test:auth` runs the password + passkey end-to-end check (software authenticator) against the running dev API and deletes its test account.
- Dev uses `MONGODB_DB=avarobe_dev` on the Trimry Atlas cluster and `STORAGE_DRIVER=local` (files in `.storage/`, served by `/api/v1/media/*` behind HMAC-signed, expiring URLs).
- In development, auth emails come back as `devLink` in the response unless the address is in `EMAIL_DEV_ALLOWLIST`.

## Flows

1. Auth (`modules/auth/routes.ts`, `passkeys.ts`, `utils/auth-links.ts`):
   - Password: `POST /auth/register {email, password, firstName?}` creates the account, signs in and sends a verification email; `POST /auth/login`; `POST /auth/password {currentPassword?, newPassword}` (signed in; revokes other sessions). argon2id, 8+ chars, per-account lockout after 10 failures for 15 min, uniform error with a timing-equal dummy check.
   - Email verification: one-time links (JWT + nonce hash on the user, 24 h). `POST /auth/verify-email/send` (signed in, 60 s cooldown), `POST /auth/verify-email {token}` confirms and signs in, returning `intent: 'passkey'` for passkey sign-ups.
   - Password recovery: `POST /auth/password/forgot {email}` always answers `{ok:true}` (60 s cooldown per account); `POST /auth/password/reset {token, newPassword}` (1 h link) checks the password before using the link, then sets it, verifies the email, revokes every session and removes passkeys.
   - Passkeys (SimpleWebAuthn v13) require a verified email to add: `POST /auth/passkeys/register/options|verify`, `GET /auth/passkeys`, `DELETE /auth/passkeys/:id`, usernameless `POST /auth/passkeys/login/options|verify`. Passkey sign-up is email-first: `POST /auth/register/passkey {email, firstName?}` sends the confirmation link; following it signs in and the web asks for the passkey. RP ID defaults to `APP_URL`'s hostname.
   - Email (`utils/email.ts`, MailerSend, tracking off): production sends everything; development only sends to `EMAIL_DEV_ALLOWLIST` and otherwise returns `devLink` in the response. Security notices go out when a password changes or a passkey is added.
2. `POST /avatar` (multipart: `selfie`, `heightCm`, `weightKg`, `build`, `presentation`, `consent=true`) normalizes the photo with sharp (rotation, resize, metadata stripped), stores it, and starts a background job that runs the color analysis (Responses API, strict JSON) and the avatar render (Images API edits, `gpt-image-2`) in parallel. Client polls `GET /avatar`.
3. `POST /looks {occasion, notes?, count 1-3}` plans the looks synchronously (stylist prompt + palette + body) and renders each in the background from the avatar image plus the selfie as face reference. Client polls `GET /looks?batchId=`.
4. Collections: `GET/POST /collections`, `GET/PATCH/DELETE /collections/:id`, `POST /collections/:id/looks`, `DELETE /collections/:id/looks/:lookId`.
5. `DELETE /me` hard-deletes the account and every stored file (promised in the privacy notice).

## Guardrails

- `MONGODB_DB` must be `avarobe` or `avarobe_<suffix>`; the API refuses to boot against another app's database on the shared cluster (a copied Trimry `.env` once pointed it at `trimry`).
- Daily generation quotas per user (`DAILY_AVATAR_LIMIT`, `DAILY_LOOK_LIMIT`) via atomic counters in `usage_counters`; failed renders give the quota back.
- Jobs are in-process. On boot, anything stuck in `processing` for 10+ minutes is marked failed (`utils/stale-jobs.ts`). Keep one PM2 instance.
- Measured costs (Sep 2026, `gpt-image-2` medium, 1024x1536): avatar ~25 s, look plan ~8 s, each look render ~25-30 s.

## Production checklist

- DNS: `avarobe.com` → web (Vercel), `api.avarobe.com` → EC2 (nginx → 4100).
- `.env`: `NODE_ENV=production`, `MONGODB_DB=avarobe`, `APP_URL=https://avarobe.com`, `API_PUBLIC_URL=https://api.avarobe.com`, `CORS_ORIGINS=https://avarobe.com,https://www.avarobe.com`, `COOKIE_DOMAIN=.avarobe.com`, new `JWT_ACCESS_SECRET`.
- Storage: private S3 bucket (block public access, SSE), `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`; EC2 instance role with `s3:GetObject/PutObject/DeleteObject` on that bucket.
- Email: `avarobe.com` is verified in MailerSend (DKIM + SPF); set `MAILERSEND_API_KEY` and `MAILERSEND_FROM_EMAIL=hello@avarobe.com`.
