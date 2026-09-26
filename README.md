# Avarobe API

Backend for [Avarobe](https://avarobe.com), an AI stylist. A person uploads a selfie plus height, weight and build; Avarobe creates a full-body 2D avatar, reads their 12-season color palette, and styles complete outfits for any occasion, rendered on the avatar and saved into collections.

## Technology

- Fastify 5 + TypeScript (NodeNext), MongoDB driver, Zod
- Passwordless sign-in links, JWT access token + rotating refresh tokens in HTTP-only cookies
- OpenAI Images API (`gpt-image-2`) for avatar and look renders, Responses API with strict JSON for color analysis and outfit planning
- sharp for photo normalization, S3 (or local disk in development) for private storage, MailerSend for email

## Development

```bash
cp .env.example .env
corepack pnpm install
corepack pnpm dev        # http://localhost:4100
corepack pnpm typecheck && corepack pnpm lint
```

See [AI_CONTEXT.md](AI_CONTEXT.md) for flows, guardrails and the production checklist.
