# avarobe-api

Fastify backend for **Avarobe** (avarobe.com), an AI stylist: a person uploads a selfie plus height, weight, build and the clothing they shop for; we generate a full-body 2D avatar and a 12-season color analysis, then style complete outfits for an occasion and render them on the avatar. Looks are saved into collections per occasion. English, US-first.

Second app of the Trimry multi-app workspace. It shares conventions with `trimry-api` (Fastify 5, zod env, Mongo driver, JWT access cookie + rotating refresh cookie, passwordless links) but runs as its own service with its own database, cookies and domain.

## Run

- `corepack pnpm --filter avarobe-api dev` (port 4100). Copy `.env.example` to `.env`.
- Dev uses `MONGODB_DB=avarobe_dev` on the Trimry Atlas cluster and `STORAGE_DRIVER=local` (files in `.storage/`, served by `/api/v1/media/*` behind HMAC-signed, expiring URLs).
- Without MailerSend in development, `POST /auth/start` returns `devLoginUrl` instead of emailing it.

## Flows

1. `POST /auth/start {email, firstName?}` creates the user on first use and sends a one-time link (nonce stored hashed on the user; consuming clears it). `POST /auth/consume {token}` issues cookies `avarobe_at` / `avarobe_rt`.
   Password: `POST /auth/register {email, password, firstName?}`, `POST /auth/login`, `POST /auth/password {currentPassword?, newPassword}` (argon2id, min 8 chars, per-account lockout after 10 failures for 15 min, same error for unknown emails with a timing-equal dummy check). Changing the password revokes other sessions.
   Passkeys (WebAuthn, SimpleWebAuthn v13): `POST /auth/passkeys/register/options|verify` (signed in), `POST /auth/passkeys/login/options|verify` (usernameless), `GET /auth/passkeys`, `DELETE /auth/passkeys/:id`. RP ID defaults to `APP_URL`'s hostname (`avarobe.com`; `localhost` in dev), expected origins are `APP_URL` + `CORS_ORIGINS`. Challenges live 5 minutes in `auth_challenges` and are single use. Only public keys and counters are stored.
   Pre-hijack guard: the first sign-in link consumed on an unverified account deletes any password/passkeys set before it and revokes sessions (`credentialsReset: true`), since someone could have registered with an email that isn't theirs.
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
- Email: verify `avarobe.com` in MailerSend, set `MAILERSEND_API_KEY` and `MAILERSEND_FROM_EMAIL`.
