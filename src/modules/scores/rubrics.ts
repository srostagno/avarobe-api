import type { ScoreKind, ScoreProblem } from '../../types/mongo.js'

// What Look Score and Hair Score measure (Oct 17, 2026): five criteria each,
// rated 0–4 against written anchors by the measuring call, so the same photo
// lands on the same score and every point can be explained. A new wording
// is a new RUBRIC_VERSION (stored on each reading); recalibrate with
// evals/scores before shipping one.

export const RUBRIC_VERSION = 'scores-2026-10-17'

export type Criterion = { id: string; name: string; measures: string; anchors: [string, string, string, string, string] }

const LOOK_CRITERIA: Criterion[] = [
  {
    id: 'color',
    name: 'Color',
    measures: 'how the colors work together and how the colors nearest the face flatter her coloring',
    anchors: [
      'colors clash, or the color by the face clearly drains or washes her out',
      'mostly flat or draining near the face, or colors that fight each other',
      'fine and safe, nothing wrong but nothing that lights her up',
      'harmonious and flattering near the face',
      'a deliberate, striking palette that clearly lights up her face',
    ],
  },
  {
    id: 'fit',
    name: 'Fit',
    measures: 'how the garments fit her: shoulders, sleeve and hem lengths, ease (not tight, not swamping)',
    anchors: [
      'several pieces clearly do not fit (pulling, gaping, swamping, wrong lengths)',
      'one clear fit problem that stands out',
      'acceptable fit with small issues',
      'fits well everywhere',
      'impeccable, tailored-looking fit',
    ],
  },
  {
    id: 'proportion',
    name: 'Proportion',
    measures: 'the silhouette: balance of volumes and lengths, where the waist and hems fall, the overall line',
    anchors: [
      'the proportions cut or overwhelm her figure badly',
      'unbalanced: too much volume or lengths that shorten her',
      'neutral, neither helps nor hurts',
      'balanced and flattering',
      'a perfectly balanced, elongating silhouette',
    ],
  },
  {
    id: 'cohesion',
    name: 'Style',
    measures: 'whether the pieces belong together with a clear point of view, current and polished rather than dated or frumpy, and suited to the occasion the outfit suggests',
    anchors: [
      'pieces fight each other, or the look is clearly dated',
      'some pieces don\'t belong, or it reads frumpy',
      'coherent but generic',
      'polished and current, with a clear style',
      'a strong, modern personal style, effortless and intentional',
    ],
  },
  {
    id: 'finish',
    name: 'Finishing',
    measures: 'shoes, bag, jewelry, belt, layers, and how cared-for the clothes look (pressed, lint-free)',
    anchors: [
      'sloppy or unfinished (creased, worn, mismatched shoes)',
      'little finishing, or one piece lets it down',
      'adequate finishing',
      'well finished with fitting shoes and accessories',
      'thoughtfully finished, every detail chosen',
    ],
  },
]

const HAIR_CRITERIA: Criterion[] = [
  {
    id: 'shape',
    name: 'Cut & shape',
    measures: 'how the cut frames and flatters her face, and how balanced its shape and volume are',
    anchors: [
      'the cut fights her face or has lost its shape completely',
      'shapeless, heavy or dragging the face down',
      'fine but without shape that helps her',
      'a flattering cut that frames her face',
      'an expertly shaped cut that lifts and frames her face',
    ],
  },
  {
    id: 'color',
    name: 'Color',
    measures: 'how the color suits her skin and eyes and how fresh it looks (regrowth, brassiness, dullness, flatness). Natural gray or silver is judged on its tone and shine, never for being gray',
    anchors: [
      'the color clearly clashes with her skin, or obvious regrowth or brassiness',
      'flat, dull or somewhat unflattering',
      'fine, neither helps nor hurts',
      'flattering and fresh',
      'a beautiful, dimensional color that lights up her face',
    ],
  },
  {
    id: 'condition',
    name: 'Condition',
    measures: 'how healthy the hair looks: shine, smoothness, ends, frizz',
    anchors: [
      'very dry, frizzy or damaged-looking',
      'dull with visible frizz or rough ends',
      'average condition',
      'healthy and shiny',
      'glossy and in excellent condition',
    ],
  },
  {
    id: 'styling',
    name: 'Styling',
    measures: 'how it is styled today: volume where it helps, polish, movement, the parting',
    anchors: [
      'unstyled and flat, or messy in a way that looks neglected',
      'little styling, flat at the roots or limp',
      'simply styled, fine',
      'well styled with good volume and movement',
      'polished, salon-quality styling',
    ],
  },
  {
    id: 'modern',
    name: 'Modern',
    measures: 'how current the overall hair looks: a cut, color and styling that feel of today rather than dated',
    anchors: [
      'clearly dated',
      'a little dated',
      'timeless but unremarkable',
      'current and fresh',
      'modern and effortlessly chic',
    ],
  },
]

export const CRITERIA: Record<ScoreKind, Criterion[]> = { look: LOOK_CRITERIA, hair: HAIR_CRITERIA }

export const criterionIds = (kind: ScoreKind) => CRITERIA[kind].map((criterion) => criterion.id)

// Where a tip leads (the web links some to a try-on): a look's tip to the
// outfit's colors, pieces or accessories; a hair tip to a cut, a color, care
// or styling.
export const TIP_AREAS: Record<ScoreKind, string[]> = {
  look: ['color', 'fit', 'silhouette', 'pieces', 'shoes', 'accessories'],
  hair: ['cut', 'color', 'care', 'styling'],
}

export const PROBLEMS: Record<ScoreKind, ScoreProblem[]> = {
  look: ['no_person', 'several_people', 'minor', 'too_dark', 'too_blurry', 'not_full_body'],
  hair: ['no_person', 'several_people', 'minor', 'too_dark', 'too_blurry', 'hair_not_visible'],
}
