// Makes the fictional test photos of evals/scores with the OpenAI images API
// (/v1/images/generations, gpt-image-2, quality medium, 1024x1536): text
// prompts only, never a real person. Skips photos already on disk, three at
// a time, and stops at the first API error. Writes photos.json (each
// photo's label and prompt) next to them.
//
//   corepack pnpm exec tsx evals/scores/generate-photos.ts
import fs from 'node:fs'
import path from 'node:path'

import { env } from '../../src/config/env.js'
import { generateImage } from '../../src/utils/openai.js'
import { PHOTOS, PHOTO_DIR } from './photos.js'

const MODEL = 'gpt-image-2'
const QUALITY = 'medium' as const
const SIZE = '1024x1536' as const
const AT_ONCE = 3

if (!env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is missing from .env.')
}

fs.mkdirSync(PHOTO_DIR, { recursive: true })

const fileOf = (id: string) => path.join(PHOTO_DIR, `${id}.png`)
const todo = PHOTOS.filter((photo) => !fs.existsSync(fileOf(photo.id)))
let stoppedBy: string | null = null
let made = 0

async function worker() {
  while (!stoppedBy) {
    const photo = todo.shift()

    if (!photo) {
      return
    }

    const started = Date.now()

    try {
      const png = await generateImage({ prompt: photo.prompt, size: SIZE, model: MODEL, quality: QUALITY, timeoutMs: 240_000 })
      fs.writeFileSync(fileOf(photo.id), png)
      made += 1
      console.log(`${photo.id} (${photo.label}) ${((Date.now() - started) / 1000).toFixed(0)} s`)
    } catch (error) {
      stoppedBy = `${photo.id}: ${(error as Error).message.slice(0, 300)}`
      console.error(`Stopped at the first API error: ${stoppedBy}`)
    }
  }
}

await Promise.all(Array.from({ length: AT_ONCE }, () => worker()))

fs.writeFileSync(
  path.join(PHOTO_DIR, 'photos.json'),
  JSON.stringify(
    {
      note: 'Fictional people, AI-generated from text prompts only (no reference photos). Test data for evals/scores in avarobe-api.',
      model: MODEL,
      quality: QUALITY,
      size: SIZE,
      photos: PHOTOS.map((photo) => ({ ...photo, file: `${photo.id}.png`, exists: fs.existsSync(fileOf(photo.id)) })),
    },
    null,
    2,
  ),
)

console.log(`${made} made, ${PHOTOS.filter((photo) => fs.existsSync(fileOf(photo.id))).length} of ${PHOTOS.length} on disk.`)
process.exitCode = stoppedBy ? 1 : 0
