// Remixes: does a variant keep the look's style and apply the change?
// Run: corepack pnpm exec tsx evals/stylist/remix-eval.ts <briefs-output.json>
import fs from 'node:fs'

import { planRemix } from '../../src/modules/looks/service.js'
import type { LookPlan, RemixChange } from '../../src/types/mongo.js'
import { createStructuredResponse } from '../../src/utils/openai.js'
import { BRIEFS } from './briefs.js'
import { describeOutfit, fmt, mean, pct, pool, retry, save } from './lib.js'
import { CLIENTS } from './profiles.js'

const CHANGES: { change: RemixChange; detail: string | null; ask: string }[] = [
  { change: 'colors', detail: null, ask: 'new colors, same pieces and attitude' },
  { change: 'season', detail: 'Winter', ask: 'the same style for winter' },
  { change: 'dressier', detail: null, ask: 'one step dressier' },
  { change: 'occasion', detail: 'A rooftop dinner with friends in October', ask: 'restyle it for a rooftop dinner in October' },
  { change: 'surprise', detail: null, ask: 'the stylist’s own twist, keeping the style' },
]

type Verdict = { dna: number; change: number; quality: number; hit: boolean; critique: string }

async function judge(base: LookPlan, remix: LookPlan, ask: string) {
  return retry(() =>
    createStructuredResponse<Verdict>({
      instructions:
        'You are a demanding fashion editor. A client asked their stylist to remix an outfit they liked. Score 0-10: dna (does the remix clearly keep the original\'s style, attitude and silhouette language, like a sibling, not a copy?), change (is the requested change clearly and fully applied?), quality (a coherent, wearable outfit right for its weather and formality). hit: true only if you would call it a great remix. critique: one short sentence.',
      content: [
        {
          type: 'input_text',
          text: `Original: ${describeOutfit(base.items)}\nRequested change: ${ask}\nRemix: ${describeOutfit(remix.items)}`,
        },
      ],
      schemaName: 'remix_audit',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['dna', 'change', 'quality', 'hit', 'critique'],
        properties: {
          dna: { type: 'integer' },
          change: { type: 'integer' },
          quality: { type: 'integer' },
          hit: { type: 'boolean' },
          critique: { type: 'string' },
        },
      },
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      timeoutMs: 180_000,
    }),
  )
}

const source = JSON.parse(fs.readFileSync(process.argv[2]!, 'utf8')) as Record<
  string,
  { brief: string; planned: { looks: LookPlan[]; dressCode: string } }[]
>
const rows = Object.values(source)[0]!
const seen = new Set<string>()
const bases = rows.filter((row) => !seen.has(row.brief) && seen.add(row.brief)).map((row) => ({ brief: BRIEFS.find((entry) => entry.id === row.brief)!, look: row.planned.looks[0]! }))
const jobs = bases.flatMap((base) => CHANGES.map((change) => ({ ...base, ...change })))

const results = await pool(jobs, 8, async (job) => {
  const avatar = CLIENTS[job.brief.client].avatar
  const planned = await retry(() =>
    planRemix({
      avatar,
      base: { plan: job.look, occasion: { text: job.brief.occasion, dressCode: '', summary: '' } },
      change: job.change,
      detail: job.detail,
    }),
  )
  const remix = planned.looks[0]!
  const verdict = await judge(job.look, remix, job.ask)
  process.stdout.write('.')
  return { brief: job.brief.id, change: job.change, base: describeOutfit(job.look.items), remix: describeOutfit(remix.items), verdict }
})

console.log('\nchange      hits   dna   change  quality')
for (const change of CHANGES) {
  const verdicts = results.filter((row) => row.change === change.change).map((row) => row.verdict)
  console.log(
    `${change.change.padEnd(10)}  ${pct(mean(verdicts.map((verdict) => (verdict.hit ? 1 : 0)))).padStart(4)}   ${fmt(mean(verdicts.map((verdict) => verdict.dna)))}   ${fmt(mean(verdicts.map((verdict) => verdict.change)))}     ${fmt(mean(verdicts.map((verdict) => verdict.quality)))}`,
  )
}
const all = results.map((row) => row.verdict)
console.log(`all         ${pct(mean(all.map((verdict) => (verdict.hit ? 1 : 0)))).padStart(4)}   ${fmt(mean(all.map((verdict) => verdict.dna)))}   ${fmt(mean(all.map((verdict) => verdict.change)))}     ${fmt(mean(all.map((verdict) => verdict.quality)))}`)
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
console.log(`Saved ${save(`remix-${stamp}`, results)}`)
