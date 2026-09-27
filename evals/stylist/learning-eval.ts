// Does the stylist learn? Simulated clients with hidden tastes react to looks
// round after round; the app's own learning turns reactions into a taste
// profile. Arms: no learning (control), learning from feedback, and learning
// plus a one-line statement written up front.
// Run: corepack pnpm exec tsx evals/stylist/learning-eval.ts [personaIds] [rounds]
import { planLooks } from '../../src/modules/looks/service.js'
import type { TasteSignal } from '../../src/modules/taste/prompts.js'
import { learnTaste, toStylistTaste } from '../../src/modules/taste/service.js'
import type { FeedbackAspect, LookPlan, TasteDocument, TasteNote } from '../../src/types/mongo.js'
import { createStructuredResponse } from '../../src/utils/openai.js'
import { describeOutfit, fmt, judgeLooks, mean, pct, pool, retry, save } from './lib.js'
import { CLIENTS, type ClientId } from './profiles.js'

type Persona = { id: string; client: ClientId; taste: string; statement: string }

const PERSONAS: Persona[] = [
  {
    id: 'rocker',
    client: 'coolSummerMan',
    taste:
      'Rugged, rock and roll, vintage. Loves boots (Chelsea, engineer, desert), leather and suede jackets, dark plain or faded band-style tees, dark or black slim jeans, silver rings and chains, worn-in textures. Hates shorts of any kind, polo shirts, loafers and boat shoes, pastel colors, and anything preppy, clean-cut or corporate.',
    statement: 'Rock and roll, vintage and rugged: boots, leather, dark colors. Never shorts, polos or loafers.',
  },
  {
    id: 'minimalist',
    client: 'deepWinterWoman',
    taste:
      'Scandinavian minimalist. Loves clean lines, black, white, grey and navy, wide-leg trousers, oversized blazers, long coats, fine knits, minimal silver jewelry, flat shoes (loafers, minimal sneakers, flat boots). Hates florals and prints, ruffles and frills, pink, heels, bodycon or tight dresses, and anything cute or girly.',
    statement: 'Minimal and clean: black, white, grey, wide trousers, flat shoes. No prints, no pink, no heels.',
  },
  {
    id: 'romantic',
    client: 'lightSpringWoman',
    taste:
      'Romantic and colorful. Loves color, florals and prints, midi dresses and skirts, puff or flutter sleeves, statement earrings, strappy sandals and block heels, feminine details. Hates all-black outfits, menswear tailoring (blazers, trouser suits), sneakers, oversized or boxy shapes, and grey or beige.',
    statement: 'I love color, florals and dresses with feminine details. No all-black, no sneakers, no suits.',
  },
  {
    id: 'prep',
    client: 'deepAutumnMan',
    taste:
      'Polished classic prep. Loves loafers, knitwear (crewnecks, cardigans, quarter-zips), chinos, oxford shirts, navy blazers, clean cuts, leather belts and watches. Hates distressed or ripped denim, graphic or band tees, boots of any kind, leather jackets, hoodies, and anything grungy or edgy.',
    statement: 'Classic and polished: loafers, knitwear, chinos, oxford shirts. Nothing ripped, no boots, no band tees.',
  },
]

// No style hints: whatever matches their taste has to come from learning.
const BRIEFS = [
  'Dinner with friends on a Friday night',
  'Weekend brunch in the city in spring',
  'Birthday party at a bar in the fall',
  'A regular day at the office, then drinks after work',
  'Day trip to a winery in early summer',
  'Casual Sunday lunch at a friend’s house',
]

const ASPECTS: FeedbackAspect[] = ['style', 'colors', 'fit', 'occasion', 'too_formal', 'too_casual', 'missed_request', 'weather']

type Reaction = {
  satisfaction: number
  dealbreakers: string[]
  rating: 'up' | 'down'
  aspects: FeedbackAspect[]
  pieces: { index: number; vote: 'up' | 'down' }[]
  note: string
}

const reactionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['looks'],
  properties: {
    looks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['satisfaction', 'dealbreakers', 'rating', 'aspects', 'pieces', 'note'],
        properties: {
          satisfaction: { type: 'integer', description: '1 (hate it) to 5 (love it, would wear it tomorrow)' },
          dealbreakers: { type: 'array', items: { type: 'string' }, description: 'Pieces in the look that you hate, per your taste.' },
          rating: { type: 'string', enum: ['up', 'down'] },
          aspects: { type: 'array', items: { type: 'string', enum: ASPECTS }, description: '0 to 2 quick chips.' },
          pieces: {
            type: 'array',
            description: '0 to 2 pieces you tap as loved (up) or disliked (down), by 0-based index in the list.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['index', 'vote'],
              properties: { index: { type: 'integer' }, vote: { type: 'string', enum: ['up', 'down'] } },
            },
          },
          note: { type: 'string', description: 'Usually empty. At most 8 words, and only on one look per round.' },
        },
      },
    },
  },
}

async function react(persona: Persona, occasion: string, looks: LookPlan[]) {
  return retry(() =>
    createStructuredResponse<{ looks: Reaction[] }>({
      instructions: [
        'You role-play a real person using a styling app. Your taste, which the app does not know:',
        persona.taste,
        'For each proposed outfit, decide honestly how much you like it given your taste, then give the quick feedback a busy person gives in an app: a thumbs up or down, at most two chips, at most two tapped pieces, and very rarely a few words.',
        'Chips: style (loved it / not my style), colors, fit, occasion (right / wrong for it), too_formal, too_casual, missed_request, weather.',
      ].join(' '),
      content: [
        {
          type: 'input_text',
          text: [
            `Occasion you asked for: ${occasion}`,
            ...looks.map(
              (look, index) =>
                `Outfit ${index + 1}, "${look.title}": ${look.items.map((item, itemIndex) => `[${itemIndex}] ${item.color} ${item.material} ${item.name}`).join('; ')}`,
            ),
          ].join('\n'),
        },
      ],
      schemaName: 'reactions',
      schema: reactionSchema,
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      timeoutMs: 180_000,
    }),
  )
}

type Arm = 'control' | 'learning' | 'statement'

async function runChain(persona: Persona, arm: Arm, rounds: number) {
  const avatar = CLIENTS[persona.client].avatar
  let taste: Pick<TasteDocument, 'statement' | 'summary' | 'loves' | 'avoids' | 'dismissed'> | null =
    arm === 'statement'
      ? { statement: persona.statement, summary: null, loves: [], avoids: [], dismissed: [] }
      : null
  const signals: TasteSignal[] = []
  const history = []

  for (let round = 0; round < rounds; round += 1) {
    const occasion = BRIEFS[round % BRIEFS.length]!
    const planned = await retry(() =>
      planLooks({ avatar, occasion, notes: null, count: 3, taste: taste ? toStylistTaste(taste as TasteDocument) : null }),
    )
    const { looks: reactions } = await react(persona, occasion, planned.looks)

    history.push({
      round: round + 1,
      occasion,
      taste: taste && { summary: taste.summary, loves: taste.loves.map((note) => note.text), avoids: taste.avoids.map((note) => note.text) },
      looks: planned.looks.map((look, index) => ({ title: look.title, items: look.items, outfit: describeOutfit(look.items), tasteApplied: look.tasteApplied, reaction: reactions[index] })),
    })

    if (arm === 'control') {
      continue
    }

    planned.looks.forEach((look, index) => {
      const reaction = reactions[index]

      if (reaction) {
        signals.unshift({
          occasion,
          plan: look,
          feedback: { rating: reaction.rating, aspects: reaction.aspects, pieces: reaction.pieces, note: reaction.note.trim() || null },
          favorite: false,
        })
      }
    })

    const current: { statement: string | null; loves: TasteNote[]; avoids: TasteNote[]; dismissed: string[] } = {
      statement: taste?.statement ?? null,
      loves: taste?.loves ?? [],
      avoids: taste?.avoids ?? [],
      dismissed: [],
    }
    const learned = await retry(() => learnTaste({ ...current, signals: signals.slice(0, 30) }))
    taste = { statement: current.statement, summary: learned.summary, loves: learned.loves, avoids: learned.avoids, dismissed: [] }
  }

  return { persona: persona.id, arm, history, finalTaste: taste }
}

const personaFilter = process.argv[2] ? process.argv[2].split(',') : undefined
const rounds = Number(process.argv[3] ?? 5)
const personas = PERSONAS.filter((persona) => !personaFilter || personaFilter.includes(persona.id))
const arms: Arm[] = ['control', 'learning', 'statement']
const chains = personas.flatMap((persona) => arms.map((arm) => ({ persona, arm })))

const results = await pool(chains, 12, async ({ persona, arm }) => {
  const result = await runChain(persona, arm, rounds)
  process.stdout.write('.')
  return result
})

console.log('\nSatisfaction (1-5) per round, then love rate (4+) and dealbreaker rate over rounds 2+')
for (const arm of arms) {
  const chainsForArm = results.filter((result) => result.arm === arm)
  const perRound = Array.from({ length: rounds }, (_, round) =>
    mean(chainsForArm.flatMap((chain) => chain.history[round]!.looks.map((look) => look.reaction?.satisfaction ?? 0))),
  )
  const later = chainsForArm.flatMap((chain) => chain.history.slice(1).flatMap((entry) => entry.looks))
  console.log(
    `${arm.padEnd(10)} ${perRound.map(fmt).join('  ')}   love ${pct(mean(later.map((look) => ((look.reaction?.satisfaction ?? 0) >= 4 ? 1 : 0))))}   dealbreakers ${pct(mean(later.map((look) => ((look.reaction?.dealbreakers.length ?? 0) > 0 ? 1 : 0))))}`,
  )
}

console.log('\nPer persona, satisfaction per round:')
for (const persona of personas) {
  for (const arm of arms) {
    const chain = results.find((result) => result.persona === persona.id && result.arm === arm)!
    console.log(`  ${persona.id.padEnd(11)} ${arm.padEnd(10)} ${chain.history.map((entry) => fmt(mean(entry.looks.map((look) => look.reaction?.satisfaction ?? 0)))).join('  ')}`)
  }
  const learned = results.find((result) => result.persona === persona.id && result.arm === 'learning')!.finalTaste
  console.log(`    learned loves: ${learned?.loves.map((note) => note.text).join(' · ')}`)
  console.log(`    learned avoids: ${learned?.avoids.map((note) => note.text).join(' · ')}`)
}

// Expertise guard: an editor who doesn't know their taste rates the last round.
const guard = await pool(results, 8, async (result) => {
  const last = result.history[result.history.length - 1]!
  const persona = PERSONAS.find((entry) => entry.id === result.persona)!
  const audit = await judgeLooks({
    occasion: last.occasion,
    avatar: CLIENTS[persona.client].avatar,
    looks: last.looks.map((look) => ({ title: look.title, items: look.items })),
  })
  return { arm: result.arm, audit }
})
console.log('\nExpertise on the last round (editor, no taste info): coherence / flattering / weather')
for (const arm of arms) {
  const scores = guard.filter((entry) => entry.arm === arm).flatMap((entry) => entry.audit.looks)
  console.log(`  ${arm.padEnd(10)} ${fmt(mean(scores.map((score) => score.coherence)))} / ${fmt(mean(scores.map((score) => score.flattering)))} / ${fmt(mean(scores.map((score) => score.weather)))}`)
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
console.log(`\nSaved ${save(`learning-${stamp}`, results)}`)
