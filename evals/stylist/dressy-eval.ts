// Dressy occasions for womenswear, from real misses of 28-30 Sep 2026: every
// cocktail wedding and cocktail-bar date look that was rated came back
// thumbs down. Two parts: new looks for those briefs, and fixes of the real
// disliked looks from their real feedback (misses.ts).
// Run: corepack pnpm exec tsx evals/stylist/dressy-eval.ts [runs] [label]
import { planLooks, planRemix } from '../../src/modules/looks/service.js'
import { describeFeedback } from '../../src/modules/taste/prompts.js'
import type { LookItem, LookPlan } from '../../src/types/mongo.js'
import { createStructuredResponse } from '../../src/utils/openai.js'
import { describeClientForJudge, describeOutfit, fmt, mean, pct, pool, retry, save, timed } from './lib.js'
import { MISSES } from './misses.js'
import { CLIENTS, type ClientId } from './profiles.js'

const runs = Number(process.argv[2] ?? 2)
const label = process.argv[3] ?? 'current'

const BRIEFS = [
  { id: 'cocktail-wedding', occasion: 'Wedding guest, invitation says cocktail attire, evening reception' },
  { id: 'bar-date', occasion: 'Dinner date at a nice cocktail bar' },
  { id: 'anniversary', occasion: 'Anniversary dinner at a nice restaurant in October' },
]
const WOMEN: ClientId[] = ['softAutumnWoman', 'deepWinterWoman', 'lightSpringWoman']
// The fixes are for one fictional client: the misses' own clients aren't known.
const FIX_CLIENT = CLIENTS.softAutumnWoman.avatar

// What the misses had in common, checked by hand rather than by the judge.
// The template: a satin wrap midi dress, or block-heel sandals with an
// envelope clutch. Mother-of-the-bride pieces: sheer wraps, shawls and the
// like, cropped evening jackets, embellished flats.
const MATRONLY = /sheer|shawl|stole|pashmina|bolero|shrug|duster|evening wrap|embellished (pointed-toe )?flats|cropped (velvet |satin |shantung )?evening jacket/i
const isSheerLayer = (item: LookItem) => (item.slot === 'layer' || item.slot === 'outerwear') && /sheer|shawl|stole|pashmina|bolero|shrug|duster|evening wrap/i.test(item.name)
const isTemplate = (items: LookItem[]) =>
  items.some((item) => item.slot === 'dress' && /wrap/i.test(item.name) && /satin/i.test(`${item.name} ${item.material}`)) ||
  (items.some((item) => item.slot === 'shoes' && /block[- ]heel/i.test(item.name)) &&
    items.some((item) => item.slot === 'bag' && /envelope clutch/i.test(item.name)))
const isMatronly = (items: LookItem[]) => items.some((item) => MATRONLY.test(item.name))
const isOffice = (items: LookItem[]) =>
  items.some((item) => /\bsuit\b|pencil skirt|button-(up|down)|sheath/i.test(item.name)) ||
  (items.some((item) => item.slot === 'bottom' && /tailored.*trousers/i.test(`${item.fit} ${item.name}`)) &&
    items.some((item) => item.slot === 'shoes' && /pumps/i.test(item.name)))
const SHOE_KINDS = ['flats', 'sandals', 'pumps', 'heels', 'boots', 'booties', 'mules', 'loafers', 'sneakers', 'slingbacks']
const shoeKind = (name: string) => SHOE_KINDS.find((kind) => name.toLowerCase().includes(kind.replace(/s$/, ''))) ?? null

type BriefVerdict = { formality: number; modern: number; flattering: number; coherence: number; hit: boolean; critique: string }
type FixVerdict = { feedback: number; occasion: number; modern: number; quality: number; hit: boolean; critique: string }

const AUDIENCE = [
  'The client is one of the stylist\'s real audience: an American woman in her 50s or 60s with a good eye, dressing for the events in her life.',
  'What this audience told us with real thumbs down: they reject the safe template (a satin wrap midi dress, block-heel ankle-strap sandals, an envelope clutch), mother-of-the-bride pieces (sheer wraps, shawls, boleros, cropped evening jackets, embellished flats), and a date dressed as cocktail attire or as office wear.',
  'Judge modern and hit with that in mind: a look built on that template is not a hit, however correct it is.',
].join(' ')

function judgeBrief(occasion: string, clientId: ClientId, look: LookPlan) {
  return retry(() =>
    createStructuredResponse<BriefVerdict>({
      instructions: [
        'You are a demanding fashion editor auditing an AI personal stylist. You see the brief, the client profile and one proposed outfit (garments only, no sales pitch).',
        AUDIENCE,
        'Score 0-10, where 10 is flawless and 5 is mediocre:',
        'formality: exactly right for this event and place. A date or dinner at a bar or restaurant calls for polished, relaxed date-night dressing, not cocktail attire and never office wear; a wedding whose invitation says cocktail attire calls for cocktail attire.',
        'modern: current and chic, never matronly, dated or a generic template.',
        'flattering: the palette near the face and a cut for her build.',
        'coherence: a real, wearable outfit whose pieces work together.',
        'hit: true only if she would say "I love it and I would wear it".',
        'critique: one short sentence.',
      ].join(' '),
      content: [
        {
          type: 'input_text',
          text: `Brief: ${occasion}\nClient: ${describeClientForJudge(CLIENTS[clientId].avatar)}\nOutfit: ${describeOutfit(look.items)}`,
        },
      ],
      schemaName: 'dressy_audit',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['formality', 'modern', 'flattering', 'coherence', 'hit', 'critique'],
        properties: {
          formality: { type: 'integer' },
          modern: { type: 'integer' },
          flattering: { type: 'integer' },
          coherence: { type: 'integer' },
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

function judgeFix(occasion: string, disliked: LookPlan, feedback: string, fix: LookPlan) {
  return retry(() =>
    createStructuredResponse<FixVerdict>({
      instructions: [
        'You are a demanding fashion editor auditing an AI personal stylist. A client rated an outfit down and gave feedback, and the stylist proposed a replacement for the same occasion.',
        AUDIENCE,
        'Score 0-10:',
        'feedback: every point of her feedback is fixed; nothing she disliked, nor anything of the same kind, comes back; what she said in her own words is honored. Pieces she said she liked belong in the replacement: never count them against it.',
        'occasion: the right formality for the occasion.',
        'modern: current and chic, never matronly or dated.',
        'quality: a coherent, wearable outfit.',
        'hit: true only if she would be happy with the replacement.',
        'critique: one short sentence.',
      ].join(' '),
      content: [
        {
          type: 'input_text',
          text: `Occasion: ${occasion}\nThe outfit she disliked: ${describeOutfit(disliked.items)}\nHer feedback: ${feedback}\nThe replacement: ${describeOutfit(fix.items)}`,
        },
      ],
      schemaName: 'fix_audit',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['feedback', 'occasion', 'modern', 'quality', 'hit', 'critique'],
        properties: {
          feedback: { type: 'integer' },
          occasion: { type: 'integer' },
          modern: { type: 'integer' },
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

// What a fix brings back that she rejected: a dress after "not a dress" or a
// disliked dress, a sheer layer after a disliked wrap, the same kind of shoe.
function fixViolations(miss: (typeof MISSES)[number], fix: LookPlan) {
  const disliked = miss.feedback.pieces.filter((piece) => piece.vote === 'down').map((piece) => miss.plan.items[piece.index]!)
  const violations: string[] = []

  if ((disliked.some((item) => item.slot === 'dress') || /not a dress|no dress/i.test(miss.feedback.note ?? '')) && fix.items.some((item) => item.slot === 'dress')) {
    violations.push('a dress again')
  }

  if (disliked.some(isSheerLayer) && fix.items.some(isSheerLayer)) {
    violations.push('a sheer layer again')
  }

  for (const shoe of disliked.filter((item) => item.slot === 'shoes')) {
    const kind = shoeKind(shoe.name)
    const again = fix.items.find((item) => item.slot === 'shoes' && kind && shoeKind(item.name) === kind)

    if (again) {
      violations.push(`${kind} again (${again.name})`)
    }
  }

  return violations
}

const briefJobs = Array.from({ length: runs }, () => BRIEFS.flatMap((brief) => WOMEN.map((client) => ({ brief, client })))).flat()
const fixJobs = Array.from({ length: runs }, () => MISSES).flat()

const briefRows = await pool(briefJobs, 8, async ({ brief, client }) => {
  const { value: planned, seconds } = await timed(() =>
    retry(() => planLooks({ avatar: CLIENTS[client].avatar, occasion: brief.occasion, notes: null, count: 1 })),
  )
  const look = planned.looks[0]!
  const verdict = await judgeBrief(brief.occasion, client, look)
  process.stdout.write('.')
  return {
    brief: brief.id,
    client,
    seconds,
    dressCode: planned.dressCode,
    outfit: describeOutfit(look.items),
    template: isTemplate(look.items),
    matronly: isMatronly(look.items),
    // A date labeled as a cocktail or formal dress code.
    dateAsCocktail: brief.id !== 'cocktail-wedding' && /cocktail|formal/i.test(planned.dressCode),
    office: brief.id !== 'cocktail-wedding' && isOffice(look.items),
    verdict,
  }
})

const fixRows = await pool(fixJobs, 8, async (miss) => {
  const detail = describeFeedback(miss.plan, miss.feedback)
  const planned = await retry(() =>
    planRemix({
      avatar: FIX_CLIENT,
      base: { plan: miss.plan, occasion: { text: miss.occasion, dressCode: '', summary: '' } },
      change: 'fix',
      detail,
    }),
  )
  const fix = planned.looks[0]!
  const verdict = await judgeFix(miss.occasion, miss.plan, detail, fix)
  process.stdout.write('.')
  return { miss: miss.id, feedback: detail, outfit: describeOutfit(fix.items), violations: fixViolations(miss, fix), template: isTemplate(fix.items), matronly: isMatronly(fix.items), verdict }
})

const rate = (rows: typeof briefRows, key: 'template' | 'matronly' | 'dateAsCocktail' | 'office') =>
  pct(mean(rows.map((row) => (row[key] ? 1 : 0)))).padStart(4)
console.log(`\n\n${label}: new looks (${briefRows.length}, 1 per plan)`)
console.log('brief              hit   formality  modern  flattering  template  matronly  date as cocktail  office')
for (const brief of BRIEFS) {
  const rows = briefRows.filter((row) => row.brief === brief.id)
  const date = brief.id !== 'cocktail-wedding'
  console.log(
    `${brief.id.padEnd(18)} ${pct(mean(rows.map((row) => (row.verdict.hit ? 1 : 0)))).padStart(4)}   ${fmt(mean(rows.map((row) => row.verdict.formality))).padStart(5)}      ${fmt(mean(rows.map((row) => row.verdict.modern)))}     ${fmt(mean(rows.map((row) => row.verdict.flattering)))}       ${rate(rows, 'template')}      ${rate(rows, 'matronly')}          ${date ? rate(rows, 'dateAsCocktail') : '   -'}        ${date ? rate(rows, 'office') : '   -'}`,
  )
}
console.log(
  `all                ${pct(mean(briefRows.map((row) => (row.verdict.hit ? 1 : 0)))).padStart(4)}   ${fmt(mean(briefRows.map((row) => row.verdict.formality))).padStart(5)}      ${fmt(mean(briefRows.map((row) => row.verdict.modern)))}     ${fmt(mean(briefRows.map((row) => row.verdict.flattering)))}       ${rate(briefRows, 'template')}      ${rate(briefRows, 'matronly')}   | ${fmt(mean(briefRows.map((row) => row.seconds)))}s per plan`,
)

console.log(`\n${label}: fixes of real misses (${fixRows.length})`)
console.log('miss                              hit   feedback  occasion  modern  rejected pieces back')
for (const miss of MISSES) {
  const rows = fixRows.filter((row) => row.miss === miss.id)
  console.log(
    `${miss.id.padEnd(32)} ${pct(mean(rows.map((row) => (row.verdict.hit ? 1 : 0)))).padStart(4)}   ${fmt(mean(rows.map((row) => row.verdict.feedback))).padStart(5)}     ${fmt(mean(rows.map((row) => row.verdict.occasion)))}      ${fmt(mean(rows.map((row) => row.verdict.modern)))}    ${rows.map((row) => row.violations.join(', ') || '-').join(' / ')}`,
  )
}
console.log(
  `all                              ${pct(mean(fixRows.map((row) => (row.verdict.hit ? 1 : 0)))).padStart(4)}   ${fmt(mean(fixRows.map((row) => row.verdict.feedback))).padStart(5)}     ${fmt(mean(fixRows.map((row) => row.verdict.occasion)))}      ${fmt(mean(fixRows.map((row) => row.verdict.modern)))}    ${fixRows.filter((row) => row.violations.length > 0).length} of ${fixRows.length} bring one back | template ${pct(mean(fixRows.map((row) => (row.template ? 1 : 0))))} | matronly ${pct(mean(fixRows.map((row) => (row.matronly ? 1 : 0))))}`,
)

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
console.log(`\nSaved ${save(`dressy-${label}-${stamp}`, { briefRows, fixRows })}`)
