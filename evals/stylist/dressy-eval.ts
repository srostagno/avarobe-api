// Womenswear occasions real clients rated down. Two parts: new looks for
// those briefs, and fixes of the real disliked looks from their real
// feedback (misses.ts), including whole fix chains where every fix was rated
// down again. Hard constraints from their own words are checked by code, and
// a gpt-5.5 judge scores the rest.
// Run: corepack pnpm exec tsx evals/stylist/dressy-eval.ts [runs] [label] [parts: briefs,fixes] [miss id prefixes]
import { planLooks, planRemix } from '../../src/modules/looks/service.js'
import { describeFeedback } from '../../src/modules/taste/prompts.js'
import type { LookItem, LookPlan } from '../../src/types/mongo.js'
import { createStructuredResponse } from '../../src/utils/openai.js'
import { describeClientForJudge, describeOutfit, fmt, mean, pct, pool, retry, save, timed, usageLine } from './lib.js'
import { MISSES, type Miss, type MissChecks } from './misses.js'
import { CLIENTS, type ClientId } from './profiles.js'

const runs = Number(process.argv[2] ?? 2)
const label = process.argv[3] ?? 'current'
const parts = (process.argv[4] || 'briefs,fixes').split(',')
const missFilter = process.argv[5] ? process.argv[5].split(',') : null

type Brief = { id: string; occasion: string; notes?: string; dressy: boolean; checks?: MissChecks }

const BRIEFS: Brief[] = [
  { id: 'cocktail-wedding', occasion: 'Wedding guest, invitation says cocktail attire, evening reception', dressy: true },
  { id: 'bar-date', occasion: 'Dinner date at a nice cocktail bar', dressy: true },
  // What the wedding guest of the 2-Oct chain wanted, said up front: her asks
  // beat the dress code's usual cocktail length.
  {
    id: 'wedding-floor',
    occasion: 'Wedding guest, invitation says cocktail attire, evening reception',
    notes: 'A floor-length dress that shows off my waist and flows when I walk, no slit, no jacket',
    dressy: true,
    checks: { dress: true, floorLength: true, noSlit: true, noOuterLayer: true },
  },
  // The most rated occasion, and where "grandma" and "frumpy" came from.
  { id: 'office', occasion: 'Regular day at an office with a business casual dress code', dressy: false },
  { id: 'boho', occasion: 'Everyday bohemian', dressy: false },
]
const WOMEN: ClientId[] = ['softAutumnWoman', 'deepWinterWoman', 'lightSpringWoman']
const DEFAULT_FIX_CLIENT: ClientId = 'softAutumnWoman'

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
// The office formulas behind "grandma" and "frumpy": a cardigan over a shell,
// ankle trousers, block-heel pumps, ponte midi skirts, mock-neck shells,
// pearl studs, walking shoes, joggers.
const DATED = /pearl stud|block[- ]heel (loafer )?pumps|ponte|mock[- ]neck[^;]*shell|walking shoe|jogger|twinset/i
const isDated = (items: LookItem[]) =>
  items.some((item) => DATED.test(`${item.name} ${item.material}`)) ||
  items.some((item) => item.slot === 'bottom' && /ankle|tapered ankle|cropped/i.test(`${item.name} ${item.fit}`)) ||
  (items.some((item) => /cardigan/i.test(item.name)) && items.some((item) => /shell/i.test(item.name)))
const isOuterLayer = (item: LookItem) =>
  item.slot === 'outerwear' ||
  item.slot === 'layer' ||
  (item.slot !== 'dress' && /jacket|blazer|\bcoat\b|cardigan|shawl|stole|pashmina|bolero|shrug|duster|\bcape\b/i.test(item.name))
const SHOE_KINDS = ['flats', 'sandals', 'pumps', 'heels', 'boots', 'booties', 'mules', 'loafers', 'sneakers', 'slingbacks']
const shoeKind = (name: string) => SHOE_KINDS.find((kind) => name.toLowerCase().includes(kind.replace(/s$/, ''))) ?? null

// How clear a color is: chroma, 0 (grey) to 1 (fully saturated).
function chroma(hex: string) {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  return (Math.max(...channels) - Math.min(...channels)) / 255
}
const CLOTHES = new Set(['top', 'layer', 'outerwear', 'bottom', 'dress', 'suit'])
// The two clearest garment colors, averaged: how much color the look shows.
const clarity = (items: LookItem[]) => {
  const values = items.filter((item) => CLOTHES.has(item.slot)).map((item) => chroma(item.colorHex)).sort((a, b) => b - a)
  return mean(values.slice(0, 2))
}

const garmentText = (item: LookItem) => `${item.name} ${item.fit} ${item.material}`
const dressOf = (items: LookItem[]) => items.find((item) => item.slot === 'dress' && !/jumpsuit|romper/i.test(item.name)) ?? null

// The hard constraints from her own words that a look breaks, by code.
function checkConstraints(items: LookItem[], checks: MissChecks | undefined, base?: LookPlan) {
  const broken: string[] = []

  if (!checks) {
    return broken
  }

  const dress = dressOf(items)

  if (checks.dress && !dress) {
    broken.push('not a dress')
  }

  if (checks.noDress && dress) {
    broken.push('a dress')
  }

  if (checks.floorLength && dress) {
    const text = `${dress.name} ${dress.fit}`

    if (/midi|knee|mini|tea[- ]length|cocktail[- ]length|ankle/i.test(text) || !/floor|full[- ]length|maxi|gown/i.test(text)) {
      broken.push(`not floor length (${dress.fit})`)
    }
  }

  if (checks.noSlit && items.some((item) => /slit/i.test(garmentText(item)) && !/no[- ]slit|without (a )?slit|slit-free/i.test(garmentText(item)))) {
    broken.push('a slit')
  }

  if (checks.noOuterLayer) {
    for (const item of items.filter(isOuterLayer)) {
      broken.push(`outer layer (${item.name})`)
    }
  }

  if (checks.fullLengthPants) {
    for (const item of items.filter((piece) => piece.slot === 'bottom' && /trouser|pant|jean|slack/i.test(piece.name))) {
      if (/ankle|crop|capri|7\/8/i.test(`${item.name} ${item.fit}`)) {
        broken.push(`short pants again (${item.fit})`)
      }
    }
  }

  if (checks.notOffice && isOffice(items)) {
    broken.push('office pieces')
  }

  const text = (field: 'color' | 'garment' | undefined) =>
    items.map((item) => (field === 'color' ? item.color : field === 'garment' ? garmentText(item) : `${item.color} ${garmentText(item)}`)).join('; ')

  for (const rule of checks.must ?? []) {
    if (!rule.pattern.test(text(rule.field))) {
      broken.push(`missing ${rule.label}`)
    }
  }

  for (const rule of checks.avoid ?? []) {
    if (rule.pattern.test(text(rule.field))) {
      broken.push(`broke "${rule.label}"`)
    }
  }

  if (checks.moreSaturated && base && clarity(items) <= clarity(base.items) + 0.02) {
    broken.push(`colors no clearer (${fmt(clarity(items) * 10)} vs ${fmt(clarity(base.items) * 10)})`)
  }

  if (checks.colorAbove) {
    const { pattern, hex, label: what } = checks.colorAbove
    const match = items.filter((item) => pattern.test(item.color))

    if (match.length > 0 && !match.some((item) => chroma(item.colorHex) > chroma(hex))) {
      broken.push(`not ${what}`)
    }
  }

  return broken
}

// What a fix brings back that she rejected (the same dress, a sheer layer
// after a disliked wrap, the same kind of shoe) or drops that she liked.
// The same dress: the same silhouette (a wrap again) or the same color.
const DRESS_SHAPES = ['wrap', 'slip', 'sheath', 'column', 'a-line', 'shirt', 'one-shoulder', 'off-shoulder', 'square-neck', 'jumpsuit']
function fixViolations(miss: Miss, fix: LookPlan) {
  const disliked = miss.feedback.pieces.filter((piece) => piece.vote === 'down').map((piece) => miss.plan.items[piece.index]!).filter(Boolean)
  const liked = miss.feedback.pieces.filter((piece) => piece.vote === 'up').map((piece) => miss.plan.items[piece.index]!).filter(Boolean)
  const violations: string[] = []
  const newDress = dressOf(fix.items)

  for (const dress of disliked.filter((item) => item.slot === 'dress')) {
    const shapes = (item: LookItem) => DRESS_SHAPES.filter((word) => item.name.toLowerCase().includes(word))
    const sameShape = newDress ? shapes(dress).some((word) => shapes(newDress).includes(word)) : false

    if (newDress && (sameShape || newDress.color.toLowerCase() === dress.color.toLowerCase())) {
      violations.push(`the same dress again (${newDress.color} ${newDress.name})`)
    }
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

  for (const piece of liked) {
    const noun = piece.name.toLowerCase().split(/\s+/).pop()!.replace(/s$/, '')

    if (!fix.items.some((item) => item.slot === piece.slot && item.name.toLowerCase().includes(noun))) {
      violations.push(`dropped the ${piece.name.toLowerCase()} she liked`)
    }
  }

  return violations
}

type BriefVerdict = {
  formality: number
  modern: number
  flattering: number
  coherence: number
  hit: boolean
  frumpy: boolean
  violations: string[]
  critique: string
}
type FixVerdict = {
  feedback: number
  occasion: number
  modern: number
  quality: number
  hit: boolean
  frumpy: boolean
  violations: string[]
  critique: string
}

const AUDIENCE = [
  'The client is one of the stylist\'s real audience: an American woman between 35 and 65 with a good eye who wants to look current and attractive, dressing for the events in her life.',
  'What this audience told us with real thumbs down: they reject the safe template (a satin wrap midi dress, block-heel ankle-strap sandals, an envelope clutch), mother-of-the-bride pieces (sheer wraps, shawls, boleros, cropped evening jackets, embellished flats), jackets and coats nobody asked for, a date dressed as cocktail attire or as office wear, office looks that read "grandma" or "frumpy" (a cardigan over a shell, ankle trousers with penny loafers, block-heel pumps, dull head-to-toe muted neutrals), colors too muted for them, and fixes that ignore what they said.',
  'Judge modern and hit with that in mind: a look built on those formulas is not a hit, however correct it is.',
  'frumpy: true if a stylish woman of her age would call it frumpy, dated, matronly or "grandma".',
].join(' ')

const VIOLATIONS = 'violations: every explicit thing she asked for or refused in her own words that the outfit breaks (a garment type, a length, a neckline, a fabric, a color, "no jacket"), quoted briefly; empty if none.'

function judgeBrief(brief: Brief, clientId: ClientId, look: LookPlan) {
  return retry(() =>
    createStructuredResponse<BriefVerdict>({
      instructions: [
        'You are a demanding fashion editor auditing an AI personal stylist. You see the brief, the client profile and one proposed outfit (garments only, no sales pitch).',
        AUDIENCE,
        'Score 0-10, where 10 is flawless and 5 is mediocre:',
        'formality: exactly right for this event and place. A date or dinner at a bar or restaurant calls for polished, relaxed date-night dressing, not cocktail attire and never office wear; a wedding whose invitation says cocktail attire calls for cocktail attire, and a floor-length dress is welcome there when she asks for one.',
        'modern: current and chic, never matronly, dated or a generic template.',
        'flattering: the palette near the face and a cut for her build.',
        'coherence: a real, wearable outfit whose pieces work together.',
        'hit: true only if she would say "I love it and I would wear it", and it breaks nothing she asked for.',
        VIOLATIONS,
        'critique: one short sentence.',
      ].join(' '),
      content: [
        {
          type: 'input_text',
          text: [
            `Brief: ${brief.occasion}`,
            brief.notes ? `Her notes: ${brief.notes}` : null,
            `Client: ${describeClientForJudge(CLIENTS[clientId].avatar)}`,
            `Outfit: ${describeOutfit(look.items)}`,
          ]
            .filter((line) => line !== null)
            .join('\n'),
        },
      ],
      schemaName: 'dressy_audit',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['formality', 'modern', 'flattering', 'coherence', 'hit', 'frumpy', 'violations', 'critique'],
        properties: {
          formality: { type: 'integer' },
          modern: { type: 'integer' },
          flattering: { type: 'integer' },
          coherence: { type: 'integer' },
          hit: { type: 'boolean' },
          frumpy: { type: 'boolean' },
          violations: { type: 'array', items: { type: 'string' } },
          critique: { type: 'string' },
        },
      },
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      timeoutMs: 180_000,
    }),
  )
}

function judgeFix(miss: Miss, feedback: string, fix: LookPlan) {
  const history = (miss.history ?? []).map(
    (step, index) => `Earlier outfit ${index + 1}: ${describeOutfit(step.plan.items)}\nHer feedback on it: ${describeFeedback(step.plan, step.feedback)}`,
  )

  return retry(() =>
    createStructuredResponse<FixVerdict>({
      instructions: [
        'You are a demanding fashion editor auditing an AI personal stylist. A client rated an outfit down and gave feedback, and the stylist proposed a replacement for the same occasion. When she rated earlier outfits for the same occasion down too, you see them and what she said: everything she said still applies unless she changed it later.',
        AUDIENCE,
        'Score 0-10:',
        'feedback: every point of her feedback, now and earlier, is fixed; nothing she disliked, nor anything of the same kind, comes back; what she said in her own words is honored; what she did not criticize is kept when it still fits. Pieces she said she liked belong in the replacement: never count them against it.',
        'occasion: the right formality for the occasion (a floor-length dress she asked for is fine at a cocktail wedding).',
        'modern: current and chic, never matronly or dated.',
        'quality: a coherent, wearable outfit.',
        'hit: true only if she would be happy with the replacement and it breaks nothing she asked for.',
        VIOLATIONS,
        'critique: one short sentence.',
      ].join(' '),
      content: [
        {
          type: 'input_text',
          text: [
            `Occasion: ${miss.occasion}`,
            miss.notes ? `Her notes: ${miss.notes}` : null,
            ...history,
            `The outfit she just disliked: ${describeOutfit(miss.plan.items)}`,
            `Her feedback: ${feedback}`,
            `The replacement: ${describeOutfit(fix.items)}`,
          ]
            .filter((line) => line !== null)
            .join('\n'),
        },
      ],
      schemaName: 'fix_audit',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['feedback', 'occasion', 'modern', 'quality', 'hit', 'frumpy', 'violations', 'critique'],
        properties: {
          feedback: { type: 'integer' },
          occasion: { type: 'integer' },
          modern: { type: 'integer' },
          quality: { type: 'integer' },
          hit: { type: 'boolean' },
          frumpy: { type: 'boolean' },
          violations: { type: 'array', items: { type: 'string' } },
          critique: { type: 'string' },
        },
      },
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      timeoutMs: 180_000,
    }),
  )
}

const misses = MISSES.filter((miss) => !missFilter || missFilter.some((prefix) => miss.id.startsWith(prefix)))
const briefJobs = parts.includes('briefs')
  ? Array.from({ length: runs }, () => BRIEFS.flatMap((brief) => WOMEN.map((client) => ({ brief, client })))).flat()
  : []
const fixJobs = parts.includes('fixes') ? Array.from({ length: runs }, () => misses).flat() : []

const briefRows = await pool(briefJobs, 8, async ({ brief, client }) => {
  const { value: planned, seconds } = await timed(() =>
    retry(() => planLooks({ avatar: CLIENTS[client].avatar, occasion: brief.occasion, notes: brief.notes ?? null, count: 1 })),
  )
  const look = planned.looks[0]!
  const verdict = await judgeBrief(brief, client, look)
  const broken = checkConstraints(look.items, brief.checks)

  // No outer layer at a dressy evening nobody said was cold.
  if (brief.dressy && !brief.checks?.noOuterLayer) {
    broken.push(...look.items.filter(isOuterLayer).map((item) => `outer layer (${item.name})`))
  }

  process.stdout.write('.')
  return {
    brief: brief.id,
    client,
    seconds,
    dressCode: planned.dressCode,
    outfit: describeOutfit(look.items),
    items: look.items,
    template: isTemplate(look.items),
    matronly: isMatronly(look.items),
    dated: isDated(look.items),
    outerLayer: look.items.some(isOuterLayer),
    clarity: clarity(look.items),
    // A date labeled as a cocktail or formal dress code.
    dateAsCocktail: brief.id === 'bar-date' && /cocktail|formal/i.test(planned.dressCode),
    office: brief.id === 'bar-date' && isOffice(look.items),
    broken,
    verdict,
  }
})

const fixRows = await pool(fixJobs, 8, async (miss) => {
  const detail = describeFeedback(miss.plan, miss.feedback)
  const planned = await retry(() =>
    planRemix({
      avatar: CLIENTS[miss.client ?? DEFAULT_FIX_CLIENT].avatar,
      base: {
        plan: miss.plan,
        occasion: { text: miss.occasion, dressCode: '', summary: '', asks: [], notes: miss.notes ?? null },
      },
      change: 'fix',
      detail,
      history: (miss.history ?? []).map((step) => ({ plan: step.plan, feedback: step.feedback })),
    }),
  )
  const fix = planned.looks[0]!
  const verdict = await judgeFix(miss, detail, fix)
  process.stdout.write('.')
  return {
    miss: miss.id,
    feedback: detail,
    outfit: describeOutfit(fix.items),
    items: fix.items,
    violations: fixViolations(miss, fix),
    broken: checkConstraints(fix.items, miss.checks, miss.plan),
    template: isTemplate(fix.items),
    matronly: isMatronly(fix.items),
    dated: isDated(fix.items),
    verdict,
  }
})

const rate = (values: boolean[]) => pct(mean(values.map((value) => (value ? 1 : 0)))).padStart(4)

if (briefRows.length > 0) {
  console.log(`\n\n${label}: new looks (${briefRows.length}, 1 per plan)`)
  console.log('brief              hit   formality  modern  frumpy  dated  outer layer  template  matronly  broken rules  judge violations')
  for (const brief of [...BRIEFS.map((entry) => entry.id), 'all']) {
    const rows = brief === 'all' ? briefRows : briefRows.filter((row) => row.brief === brief)
    console.log(
      `${brief.padEnd(18)} ${rate(rows.map((row) => row.verdict.hit))}   ${fmt(mean(rows.map((row) => row.verdict.formality))).padStart(5)}      ${fmt(mean(rows.map((row) => row.verdict.modern)))}    ${rate(rows.map((row) => row.verdict.frumpy))}   ${rate(rows.map((row) => row.dated))}      ${rate(rows.map((row) => row.outerLayer))}       ${rate(rows.map((row) => row.template))}      ${rate(rows.map((row) => row.matronly))}      ${String(rows.reduce((sum, row) => sum + row.broken.length, 0)).padStart(3)}            ${String(rows.reduce((sum, row) => sum + row.verdict.violations.length, 0)).padStart(3)}`,
    )
  }
  const dates = briefRows.filter((row) => row.brief === 'bar-date')
  console.log(`dates labeled cocktail ${rate(dates.map((row) => row.dateAsCocktail))} | dates in office pieces ${rate(dates.map((row) => row.office))} | ${fmt(mean(briefRows.map((row) => row.seconds)))}s per plan`)
}

if (fixRows.length > 0) {
  console.log(`\n${label}: fixes of real misses (${fixRows.length})`)
  console.log('miss                           hit   feedback  modern  frumpy  broken rules (code) / rejected or dropped pieces')
  for (const miss of misses) {
    const rows = fixRows.filter((row) => row.miss === miss.id)
    console.log(
      `${miss.id.padEnd(30)} ${rate(rows.map((row) => row.verdict.hit))}   ${fmt(mean(rows.map((row) => row.verdict.feedback))).padStart(5)}     ${fmt(mean(rows.map((row) => row.verdict.modern)))}    ${rate(rows.map((row) => row.verdict.frumpy))}   ${rows.map((row) => [...row.broken, ...row.violations].join(', ') || '-').join(' / ')}`,
    )
  }
  const withBroken = fixRows.filter((row) => row.broken.length > 0).length
  console.log(
    `all                            ${rate(fixRows.map((row) => row.verdict.hit))}   ${fmt(mean(fixRows.map((row) => row.verdict.feedback))).padStart(5)}     ${fmt(mean(fixRows.map((row) => row.verdict.modern)))}    ${rate(fixRows.map((row) => row.verdict.frumpy))}`,
  )
  console.log(
    `hard rules broken (code): ${fixRows.reduce((sum, row) => sum + row.broken.length, 0)} in ${withBroken} of ${fixRows.length} fixes | judge violations: ${fixRows.reduce((sum, row) => sum + row.verdict.violations.length, 0)} in ${fixRows.filter((row) => row.verdict.violations.length > 0).length} | rejected or dropped pieces: ${fixRows.filter((row) => row.violations.length > 0).length} | template ${pct(mean(fixRows.map((row) => (row.template ? 1 : 0))))} | matronly ${pct(mean(fixRows.map((row) => (row.matronly ? 1 : 0))))} | dated ${pct(mean(fixRows.map((row) => (row.dated ? 1 : 0))))}`,
  )
  const chains = fixRows.filter((row) => /chain/.test(row.miss))
  if (chains.length > 0) {
    console.log(`chain steps: hit ${rate(chains.map((row) => row.verdict.hit))}, hard rules broken ${chains.reduce((sum, row) => sum + row.broken.length, 0)} in ${chains.filter((row) => row.broken.length > 0).length} of ${chains.length}`)
  }
  for (const row of fixRows.filter((entry) => entry.miss.startsWith('wedding-chain'))) {
    console.log(`  ${row.miss}: ${row.verdict.hit ? 'HIT' : 'miss'} | ${row.outfit}${row.broken.length > 0 ? ` | broken: ${row.broken.join(', ')}` : ''}`)
  }
}

console.log(`\n${usageLine()}`)
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
console.log(`Saved ${save(`dressy-${label}-${stamp}`, { briefRows, fixRows })}`)
