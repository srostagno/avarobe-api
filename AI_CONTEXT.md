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
2. `POST /avatar` (multipart: `selfie` required the first time, optional `bodyPhoto`, `heightCm`, `weightKg`, `build`, `presentation`, `consent=true` for new photos) normalizes photos with sharp (rotation, resize, metadata stripped) and starts a background job: the color analysis (Responses API, strict JSON) is saved the moment it's ready, and the render (Images API edits, `gpt-image-2`, streamed with 2 partial images) saves previews to `job.previewKey` as it goes. Client polls `GET /avatar` every 2 s and shows steps, palette and previews. Prompts insist on one coherent photograph (head-to-body scale, matching skin tone, 85mm framing); a full-body photo gives the real proportions.
   - `POST /avatar/refine {adjustments[], notes?}` edits the current avatar (current render + selfie + body photo as references) with targeted fixes (`more_like_me`, `head_smaller`, `head_larger`, `slimmer`, `fuller`, `broader_shoulders`, `narrower_shoulders`, `match_skin`). A failed refinement leaves the previous avatar ready.
   - Every render is kept as a version (6 most recent); `POST /avatar/versions/:id/select` switches back. `DELETE /avatar/body-photo` removes the full-body photo. Creating or refining counts against `DAILY_AVATAR_LIMIT` (default 8).
3. `POST /looks {occasion, notes?, count 1-3}` plans the looks synchronously (stylist prompt + palette + body) and renders each in the background from the avatar image plus the selfie as face reference, streaming a preview into `previewKey`. Client polls `GET /looks?batchId=`.
4. Collections: `GET/POST /collections`, `GET/PATCH/DELETE /collections/:id`, `POST /collections/:id/looks`, `DELETE /collections/:id/looks/:lookId`.
5. `DELETE /me` hard-deletes the account and every stored file (promised in the privacy notice).

## Guardrails

- `MONGODB_DB` must be `avarobe` or `avarobe_<suffix>`; the API refuses to boot against another app's database on the shared cluster (a copied Trimry `.env` once pointed it at `trimry`).
- Daily generation quotas per user (`DAILY_AVATAR_LIMIT`, `DAILY_LOOK_LIMIT`) via atomic counters in `usage_counters`; failed renders give the quota back.
- Jobs are in-process. On boot, anything stuck in `processing` for 10+ minutes is marked failed (`utils/stale-jobs.ts`). Keep one PM2 instance.
- Measured (Sep 2026, `gpt-image-2` medium, 1024x1536): palette ~7 s, first avatar preview ~9 s, second ~19 s, avatar ready ~25-30 s; refinement ~25 s; look plan ~5-8 s, look preview ~7 s into the render, look ready ~25-30 s.

## Production checklist

- DNS: `avarobe.com` → web (Vercel), `api.avarobe.com` → EC2 (nginx → 4100).
- `.env`: `NODE_ENV=production`, `MONGODB_DB=avarobe`, `APP_URL=https://avarobe.com`, `API_PUBLIC_URL=https://api.avarobe.com`, `CORS_ORIGINS=https://avarobe.com,https://www.avarobe.com`, `COOKIE_DOMAIN=.avarobe.com`, new `JWT_ACCESS_SECRET`.
- Storage: private S3 bucket (block public access, SSE), `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`; EC2 instance role with `s3:GetObject/PutObject/DeleteObject` on that bucket.
- Email: `avarobe.com` is verified in MailerSend (DKIM + SPF); set `MAILERSEND_API_KEY` and `MAILERSEND_FROM_EMAIL=hello@avarobe.com`.
