import type { ScoreKind, ScoreProblem } from '../../types/mongo.js'

// What Look Score and Hair Score measure (Oct 17, 2026): five criteria each,
// rated 0–4 against written anchors by the measuring call, so the same photo
// lands on the same score and every point can be explained. A new wording
// is a new RUBRIC_VERSION (stored on each reading); recalibrate with
// evals/scores before shipping one.

export const RUBRIC_VERSION = 'scores-2026-10-17c'

export type Criterion = { id: string; name: string; measures: string; anchors: [string, string, string, string, string] }

const LOOK_CRITERIA: Criterion[] = [
  {
    id: 'color',
    name: 'Color',
    measures:
      'how the colors work together and how the colors nearest the face flatter her coloring. When colors in the outfit clash, rate the clash even if the color by the face flatters',
    anchors: [
      'two or more colors clash, or the color by the face clearly drains her',
      'one color fights the rest, or the color by the face is draining',
      'fine and safe, nothing wrong but nothing that lights her up',
      'every color works with the others and the color by the face flatters',
      'a deliberate, striking palette that clearly lights up her face',
    ],
  },
  {
    id: 'fit',
    name: 'Fit',
    measures:
      "how each garment's size and cut suit her: pulling or gaping at buttons, riding up, too tight, too loose, sleeves or hems too short or long. These are faults of the garment's size, never of her body",
    anchors: [
      'two or more pieces are visibly the wrong size or length',
      'one piece is visibly the wrong size or length (pulling, gaping, riding up, too short, swamping)',
      'acceptable fit with small issues',
      'every piece fits; nothing pulls, gapes or bunches',
      'fits as if tailored: clean shoulders, exact hems',
    ],
  },
  {
    id: 'proportion',
    name: 'Proportion',
    measures: 'the line, separate from fit: where the waist is marked or suggested, where hems fall (knee, mid-calf, ankle), top versus bottom volume',
    anchors: [
      'volume and lengths fight each other (a long shapeless top over wide or cropped bottoms, a hem at the widest point)',
      'one length or volume choice shortens or widens the line',
      'neutral: no defined line, nothing wrong',
      'a clear, balanced line (waist marked, or a clean column; hems at a flattering point)',
      'a deliberately elongating line, every length chosen',
    ],
  },
  {
    id: 'cohesion',
    name: 'Style',
    measures: 'whether the pieces belong together and look current, suited to the occasion the outfit suggests',
    anchors: [
      'pieces clash in style or era (for example sporty socks with dressy shoes)',
      "reads frumpy or dated, or a piece doesn't belong",
      'coherent but generic, or neat but dated',
      'coherent and current: the shapes and pieces look like this decade',
      'a strong, modern personal style, effortless and intentional',
    ],
  },
  {
    id: 'finish',
    name: 'Finishing',
    measures: 'shoes, bag, jewelry, belt, layers, and how cared-for the clothes look (pressed, lint-free, shoes in good shape)',
    anchors: [
      'visible wear or neglect: stains, pilling, heavy creases, scuffed or dirty shoes',
      "one thing lets it down (creases, worn shoes, a bag that doesn't go)",
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
    measures:
      'how the color suits her skin and eyes and how fresh it looks (regrowth, brassiness, dullness, flatness). Natural gray or silver is judged on its tone and shine, never for being gray',
    anchors: [
      'regrowth wider than a finger, strong brassy or orange tones, or a color that clearly clashes with her skin',
      'some visible regrowth or brassiness, or a flat, dull color',
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
      'dry, frizzy or broken ends along most of the hair',
      'frizz or rough ends visible in places',
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
    measures: 'how current the cut and styling look (shape, length, layers, parting), not the color',
    anchors: [
      'a clearly dated shape (a grown-out perm, a helmet set)',
      'a little dated: heavy one-length, or an old-fashioned parting',
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
