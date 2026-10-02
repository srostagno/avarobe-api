// Brief adherence: the old stylist prompt against the new one (and models).
// Run: corepack pnpm exec tsx evals/stylist/briefs-eval.ts [armIds] [briefIds]
import type { LookPlan } from '../../src/types/mongo.js'
import { createStructuredResponse } from '../../src/utils/openai.js'
import { planLooks } from '../../src/modules/looks/service.js'
import {
  BASELINE_LOOK_PLAN_INSTRUCTIONS,
  baselineLookPlanSchema,
  buildBaselineLookPlanRequest,
} from './baseline.js'
import { BRIEFS } from './briefs.js'
import { fmt, judgeLooks, mean, pct, pool, retry, save, timed, usageLine, withStylist } from './lib.js'
import { CLIENTS } from './profiles.js'

type Arm = { id: string; label: string; model: string; effort: 'low' | 'medium' | 'high'; baseline?: boolean }

const ARMS: Arm[] = [
  { id: 'old', label: 'Old prompt, gpt-5.4-mini low (production)', model: 'gpt-5.4-mini', effort: 'low', baseline: true },
  { id: 'new-mini', label: 'New prompt, gpt-5.4-mini low', model: 'gpt-5.4-mini', effort: 'low' },
  { id: 'new-5.4', label: 'New prompt, gpt-5.4 low', model: 'gpt-5.4', effort: 'low' },
  { id: 'new-5.5', label: 'New prompt, gpt-5.5 low', model: 'gpt-5.5', effort: 'low' },
  { id: 'new-5.5-med', label: 'New prompt, gpt-5.5 medium', model: 'gpt-5.5', effort: 'medium' },
]

const armFilter = process.argv[2] ? process.argv[2].split(',') : undefined
const briefFilter = process.argv[3] ? process.argv[3].split(',') : undefined
const runs = Number(process.argv[4] ?? 1)
const arms = ARMS.filter((arm) => !armFilter || armFilter.includes(arm.id))
const briefs = BRIEFS.filter((brief) => !briefFilter || briefFilter.includes(brief.id))

async function plan(arm: Arm, brief: (typeof BRIEFS)[number]) {
  const avatar = CLIENTS[brief.client].avatar
  const notes = brief.notes ?? null

  if (arm.baseline) {
    const response = await createStructuredResponse<{ looks: LookPlan[]; dressCode: string }>({
      instructions: BASELINE_LOOK_PLAN_INSTRUCTIONS,
      content: [{ type: 'input_text', text: buildBaselineLookPlanRequest({ avatar, occasion: brief.occasion, notes, count: 3 }) }],
      schemaName: 'look_plan',
      schema: baselineLookPlanSchema,
      model: arm.model,
      reasoningEffort: arm.effort,
      timeoutMs: 180_000,
    })
    return { asks: [] as string[], looks: response.looks.slice(0, 3), dressCode: response.dressCode }
  }

  return planLooks({ avatar, occasion: brief.occasion, notes, count: 3 })
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const results: Record<string, unknown[]> = {}

for (const arm of arms) {
  const jobs = Array.from({ length: runs }, () => briefs).flat()
  const rows = await withStylist(arm.model, arm.effort, () =>
    pool(jobs, 8, async (brief) => {
      const { value: planned, seconds } = await timed(() => retry(() => plan(arm, brief)))
      const audit = await judgeLooks({
        occasion: brief.occasion,
        notes: brief.notes,
        avatar: CLIENTS[brief.client].avatar,
        looks: planned.looks,
      })
      process.stdout.write('.')
      return { brief: brief.id, seconds, planned, audit }
    }),
  )
  results[arm.id] = rows

  const scores = rows.flatMap((row) => row.audit.looks)
  const summary = {
    hit: mean(scores.map((score) => (score.hit ? 1 : 0))),
    adherence: mean(scores.map((score) => score.adherence)),
    fidelity: mean(scores.map((score) => score.fidelity)),
    weather: mean(scores.map((score) => score.weather)),
    coherence: mean(scores.map((score) => score.coherence)),
    flattering: mean(scores.map((score) => score.flattering)),
    variety: mean(rows.map((row) => row.audit.variety)),
    violations: scores.reduce((sum, score) => sum + score.violations.length, 0),
    seconds: mean(rows.map((row) => row.seconds)),
  }
  console.log(
    `\n${arm.label}\n  hit ${pct(summary.hit)} | adherence ${fmt(summary.adherence)} | fidelity ${fmt(summary.fidelity)} | weather ${fmt(summary.weather)} | coherence ${fmt(summary.coherence)} | flattering ${fmt(summary.flattering)} | variety ${fmt(summary.variety)} | violations ${summary.violations} | ${fmt(summary.seconds)}s per plan`,
  )
  for (const brief of briefs) {
    const looks = rows.filter((row) => row.brief === brief.id).flatMap((row) => row.audit.looks)
    console.log(
      `  ${brief.id.padEnd(18)} hits ${looks.filter((look) => look.hit).length}/${looks.length}  adh ${fmt(mean(looks.map((look) => look.adherence)))}  fid ${fmt(mean(looks.map((look) => look.fidelity)))}`,
    )
  }
}

console.log(`\n${usageLine()}`)
console.log(`Saved ${save(`briefs-${stamp}`, results)}`)
