import type { IconLook } from './icons.js'

// Edits: seasonal and event collections of looks to try on, one new drop at a
// time, so there's always something new in the studio (Silvio, Oct 2026).
// Each look works like an icon look: a catalog image (the try-on reference,
// assets/icon-looks/<id>.jpg here and public/icon-looks/<id>.webp in the web)
// plus the exact pieces, tried on the person's avatar in one tap under their
// plan's limits. People are fictional: Avarobe's demo people
// (design/ai-samples/diverse/<person>) or Greta, Silvio's character from the
// Halloween reels. No real person, brand, logo or lettering. The images come
// from design/ai-samples/edits/generate.mts, which reads this file, so it has
// no runtime imports. Each Edit also has a public page in the web
// (/collections/<slug>): after a change here, run `node scripts/sync-edits.mts`
// in avarobe-web, and give a new Edit its slug and search copy there
// (src/content/collections.ts, i18n/slugs.ts).

export type EditLook = IconLook & {
  // Where the catalog photo is set (for the image generator; costume
  // try-ons are drawn there too).
  scene: string
  // A ready image instead of a generated one (path under design/).
  source?: string
  // A costume's face paint, drawn on the person's own face in the try-on.
  makeup?: string
}

export type Edit = {
  id: string
  name: string
  emoji: string
  // One line under the name.
  tagline: string
  // When it dropped (YYYY-MM-DD); shown as new for a week.
  droppedAt: string
  // Costumes: try-ons are drawn at night in the look's own scene, with its
  // face paint, instead of in the studio (costumeFor).
  costumes?: boolean
  looks: EditLook[]
}

// The drops announced next, one every Tuesday, so people know when to come
// back. The app promises a new Edit every week: each one has to be in EDITS
// (looks and images) by its date.
export const UPCOMING_EDITS: { name: string; emoji: string; at: string }[] = [
  { name: 'The Fall Wedding Guest Edit', emoji: '💐', at: '2026-10-13' },
  { name: 'The Last-Minute Costume Edit', emoji: '🦇', at: '2026-10-20' },
  { name: 'The Sweater Weather Edit', emoji: '🧶', at: '2026-10-27' },
  { name: 'The Thanksgiving Edit', emoji: '🦃', at: '2026-11-03' },
  { name: 'The Holiday Party Edit', emoji: '✨', at: '2026-11-10' },
  { name: 'The Holiday Travel Edit', emoji: '✈️', at: '2026-11-17' },
  { name: 'The Winter Coat Edit', emoji: '🧥', at: '2026-11-24' },
  { name: 'The Christmas Edit', emoji: '🎄', at: '2026-12-01' },
  { name: 'The Office Party Edit', emoji: '🥂', at: '2026-12-08' },
  { name: "The New Year's Eve Edit", emoji: '🎆', at: '2026-12-15' },
]

const HALLOWEEN = 'Halloween 2026'
const FALL = 'Fall 2026'
const WEDDINGS = 'Fall Weddings 2026'
const ZODIAC_ERA = 'Halloween 2026 · by your sign'
const GRETA = 'ads/2026-10-halloween-wow/src/stills'
// Greta's costumes from the Halloween Part 2 reel (Oct 12): the ones the
// Halloween ad shows, first in the Edit. The older Spider Queen and Black
// Swan were renamed (Spider Web Gown, Dark Ballerina) for these.
const PART2 = 'social/2026-10-halloween-part2/gen'
// The white-dress reel (Oct 15, design/social/2026-10-halloween-white): one
// white satin slip dress, six costumes, each a few pieces over it. The older
// Ghost Bride and Ice Queen were renamed (Victorian Ghost, Snow Queen) for
// these. Its creator is fictional, like Greta.
const WHITE = 'social/2026-10-halloween-white/gen'
const WHITE_BASE: EditLook['items'] = [
  { slot: 'dress', name: 'Satin slip dress', color: 'White', colorHex: '#F3F0EA', material: 'Satin', fit: 'Midi, cowl neck, thin straps, bias cut' },
  { slot: 'shoes', name: 'Strappy sandals', color: 'White', colorHex: '#EFECE6', material: 'Leather', fit: 'Thin straps, stiletto heel' },
]

const halloween: EditLook[] = [
  {
    id: 'hw-catrina', presentation: 'womenswear', name: 'La Catrina', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${PART2}/catrina.png`,
    scene: 'a dark room glowing with dozens of candles and marigolds on the floor, in a warm gold haze',
    makeup: 'elegant sugar-skull face paint: a white base, black eye sockets ringed with small colorful petals, a small black nose and stitched lips',
    description: 'A crown of marigolds and roses, black lace and gold: the most beautiful costume of the night.',
    items: [
      { slot: 'accessory', name: 'Marigold flower crown', color: 'Marigold and red', colorHex: '#E8891C', material: 'Silk flowers', fit: 'A lush crown of big marigolds and red roses' },
      { slot: 'outerwear', name: 'Lace mantilla shawl', color: 'Black', colorHex: '#141414', material: 'Lace', fit: 'Draped over the shoulders' },
      { slot: 'top', name: 'Turtleneck', color: 'Black', colorHex: '#151515', material: 'Fine knit', fit: 'Fitted' },
      { slot: 'bottom', name: 'Mini skirt', color: 'Black', colorHex: '#161616', material: 'Crepe', fit: 'A-line, above the knee, over sheer black tights' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Large' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Block heel' },
    ],
  },
  {
    id: 'hw-red-devil', presentation: 'womenswear', name: 'Red Devil', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${PART2}/devil.png`,
    scene: 'a dark living room lit red from the floor, with deep crimson shadows',
    makeup: 'bold red lips, sharp black winged liner and a small red heart drawn under one eye',
    description: 'Glossy horns and a long red cape: two pieces, all the drama.',
    items: [
      { slot: 'accessory', name: 'Horns headband', color: 'Red', colorHex: '#B3141B', material: 'Glossy resin', fit: 'Small horns' },
      { slot: 'outerwear', name: 'Long cape', color: 'Red', colorHex: '#A3121A', material: 'Satin', fit: 'From the shoulders to the ankles' },
      { slot: 'top', name: 'Turtleneck', color: 'Black', colorHex: '#151515', material: 'Fine knit', fit: 'Fitted' },
      { slot: 'bottom', name: 'Mini skirt', color: 'Black', colorHex: '#161616', material: 'Crepe', fit: 'A-line, above the knee, over sheer black tights' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Block heel' },
    ],
  },
  {
    id: 'hw-spider-veil', presentation: 'womenswear', name: 'Spider Queen', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${PART2}/spider.png`,
    scene: 'a dark living room glowing acid green from below, in a green-tinted haze',
    makeup: 'dark plum lips and smoky green-black eyes',
    description: 'A spiderweb veil, a lace web from shoulder to wrist and silver spiders: eerie in two pieces.',
    items: [
      { slot: 'accessory', name: 'Spiderweb lace veil', color: 'Black', colorHex: '#121212', material: 'Lace', fit: 'Draped from a small black headpiece over the hair' },
      { slot: 'outerwear', name: 'Lace web shawl', color: 'Black', colorHex: '#141414', material: 'Lace', fit: 'A large web wrapped from the shoulders to the wrists' },
      { slot: 'accessory', name: 'Spider earrings', color: 'Silver', colorHex: '#BFC3C8', material: 'Metal', fit: 'Dangling' },
      { slot: 'top', name: 'Turtleneck', color: 'Black', colorHex: '#151515', material: 'Fine knit', fit: 'Fitted' },
      { slot: 'bottom', name: 'Mini skirt', color: 'Black', colorHex: '#161616', material: 'Crepe', fit: 'A-line, above the knee, over sheer black tights' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Block heel' },
    ],
  },
  {
    id: 'hw-black-swan-tutu', presentation: 'womenswear', name: 'Black Swan', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${PART2}/swan.png`,
    scene: 'a dark room lit by cold steel-blue moonlight from the window, with silver highlights',
    makeup: 'dramatic black-and-white winged eye makeup sweeping toward the temples, with tiny rhinestones, and dark lips',
    description: 'A black tutu, a feather collar and a feathered crown: a ballerina with a dark side.',
    items: [
      { slot: 'accessory', name: 'Feathered headpiece', color: 'Black', colorHex: '#121212', material: 'Feathers', fit: 'Small, on top of the head' },
      { slot: 'accessory', name: 'Feather collar', color: 'Black', colorHex: '#151515', material: 'Feathers', fit: 'Dramatic, over the shoulders' },
      { slot: 'top', name: 'Turtleneck', color: 'Black', colorHex: '#151515', material: 'Fine knit', fit: 'Fitted' },
      { slot: 'bottom', name: 'Tulle tutu', color: 'Black', colorHex: '#141414', material: 'Tulle', fit: 'Short, layered over a mini skirt and sheer black tights' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Block heel' },
    ],
  },
  {
    id: 'hw-glam-skeleton', presentation: 'womenswear', name: 'Glam Skeleton', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${PART2}/skeleton.png`,
    scene: 'a dark room under a cold white spotlight from above, with deep black shadows and a faint blue haze',
    makeup: 'half-face skeleton makeup: white bone shading, a black eye socket and teeth drawn over the lips on one side, a glamorous smoky eye on the other',
    description: 'Half skeleton, half glam: bone gloves and a bone print down the front.',
    items: [
      { slot: 'top', name: 'Bone-print turtleneck', color: 'Black and white', colorHex: '#1A1A1A', material: 'Fine knit', fit: 'Fitted, a white ribcage and spine painted down the front' },
      { slot: 'accessory', name: 'Skeleton gloves', color: 'Black and white', colorHex: '#E8E6E1', material: 'Stretch fabric', fit: 'Bone print, wrist length' },
      { slot: 'bottom', name: 'Mini skirt', color: 'Black', colorHex: '#161616', material: 'Crepe', fit: 'A-line, above the knee, over sheer black tights' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Block heel' },
    ],
  },
  {
    id: 'hw-white-swan', presentation: 'womenswear', name: 'White Swan', era: HALLOWEEN, mood: 'Costume party', person: 'creator-c', source: `${WHITE}/swan.png`,
    scene: 'a living room at night lit by cold blue moonlight from the window, with a few candles',
    makeup: 'silver winged liner, silver shimmer on the lids and tiny rhinestones at the outer corners of the eyes',
    description: 'A feather crown and feathers down the arms like wings: the swan, in two pieces over a white dress.',
    items: [
      { slot: 'accessory', name: 'Feather crown', color: 'White', colorHex: '#F5F3EE', material: 'Feathers and crystals', fit: 'Spiky, with small crystals' },
      { slot: 'outerwear', name: 'Feather wing shawl', color: 'White', colorHex: '#F2F0EB', material: 'Feathers', fit: 'Over the shoulders and down the arms like wings' },
      ...WHITE_BASE,
    ],
  },
  {
    id: 'hw-white-ghost-bride', presentation: 'womenswear', name: 'Ghost Bride', era: HALLOWEEN, mood: 'Costume party', person: 'creator-c', source: `${WHITE}/ghostbride.png`,
    scene: 'a living room at night filled with low pale green fog',
    makeup: 'pale skin, grey hollow shading around the eyes and dark plum lips',
    description: 'A torn veil to the floor and a wilted bouquet: the white dress, haunted.',
    items: [
      { slot: 'accessory', name: 'Torn tulle veil', color: 'Ivory', colorHex: '#ECE7DC', material: 'Tulle', fit: 'From the top of the head to the floor, with frayed edges' },
      { slot: 'accessory', name: 'Wilted rose bouquet', color: 'Dusty rose and brown', colorHex: '#7E5A52', material: 'Dried flowers', fit: 'Held at the waist' },
      ...WHITE_BASE,
    ],
  },
  {
    id: 'hw-white-fallen-angel', presentation: 'womenswear', name: 'Fallen Angel', era: HALLOWEEN, mood: 'Costume party', person: 'creator-c', source: `${WHITE}/fallenangel.png`,
    scene: 'a dark living room with a strong white backlight behind her and a light haze',
    makeup: 'smoky dark eyes and a deep oxblood lip',
    description: 'Big black wings and a crooked halo over a white dress: an angel who fell, beautifully.',
    items: [
      { slot: 'accessory', name: 'Feather wings', color: 'Black', colorHex: '#121212', material: 'Feathers', fit: 'Large, on the back, down to the knees' },
      { slot: 'accessory', name: 'Broken halo headband', color: 'Gold', colorHex: '#C9A44C', material: 'Metal wire', fit: 'A tilted, broken ring above the head' },
      ...WHITE_BASE,
    ],
  },
  {
    id: 'hw-white-greek-goddess', presentation: 'womenswear', name: 'Greek Goddess', era: HALLOWEEN, mood: 'Costume party', person: 'creator-c', source: `${WHITE}/goddess.png`,
    scene: 'a living room at night lit by dozens of candles in warm amber light',
    makeup: 'gold shimmer on the eyelids and a soft nude lip',
    description: 'A gold laurel crown, a chiffon drape and gold cuffs: a goddess, from a white dress.',
    items: [
      { slot: 'accessory', name: 'Laurel crown', color: 'Gold', colorHex: '#C9A44C', material: 'Metal leaves', fit: 'Around the head' },
      { slot: 'outerwear', name: 'Chiffon toga drape', color: 'Ivory', colorHex: '#F1ECE2', material: 'Chiffon', fit: 'Over one shoulder, falling to the floor' },
      { slot: 'accessory', name: 'Rope belt', color: 'Gold', colorHex: '#C8A24A', material: 'Braided cord', fit: 'At the waist, with tassels' },
      { slot: 'accessory', name: 'Arm cuffs', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'On the upper arms' },
      ...WHITE_BASE,
    ],
  },
  {
    id: 'hw-white-ice-queen', presentation: 'womenswear', name: 'Ice Queen', era: HALLOWEEN, mood: 'Costume party', person: 'creator-c', source: `${WHITE}/icequeen.png`,
    scene: 'a living room at night in icy cyan-blue light with a low mist',
    makeup: 'frosted white lashes, silver shimmer on the lids and pale glossy lips',
    description: 'A crystal crown and a white faux-fur stole: frozen glamour over a white dress.',
    items: [
      { slot: 'accessory', name: 'Crystal crown', color: 'Silver', colorHex: '#D8DDE2', material: 'Crystals', fit: 'Tall spikes' },
      { slot: 'outerwear', name: 'Faux-fur stole', color: 'White', colorHex: '#F4F2EE', material: 'Faux fur', fit: 'Big, around the shoulders and arms' },
      ...WHITE_BASE,
    ],
  },
  {
    id: 'hw-white-vampire-bride', presentation: 'womenswear', name: 'Vampire Bride', era: HALLOWEEN, mood: 'Costume party', person: 'creator-c', source: `${WHITE}/vampirebride.png`,
    scene: 'a living room at night bathed in deep red light, with red candles and rose petals on the floor',
    makeup: 'a deep red lip with a small drawn blood drip at one corner and dark smoky eyes',
    description: 'Red lace gloves, a choker and one red rose: the white dress, bitten.',
    items: [
      { slot: 'accessory', name: 'Lace opera gloves', color: 'Red', colorHex: '#9E1520', material: 'Lace', fit: 'Above the elbow' },
      { slot: 'accessory', name: 'Lace choker', color: 'Red', colorHex: '#8E1420', material: 'Lace', fit: 'With a small drop pendant' },
      { slot: 'accessory', name: 'Red rose', color: 'Red', colorHex: '#A3121A', material: 'Faux flower', fit: 'Held in one hand' },
      ...WHITE_BASE,
    ],
  },
  {
    id: 'hw-couture-pumpkin', presentation: 'womenswear', name: 'Couture Pumpkin', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${GRETA}/pumpkin.png`,
    scene: 'a front porch at night between carved jack-o-lanterns',
    description: 'A sculptural pumpkin ballgown with a vine headpiece: the costume nobody forgets.',
    items: [
      { slot: 'dress', name: 'Pumpkin ballgown', color: 'Burnt orange', colorHex: '#C4561B', material: 'Satin', fit: 'Strapless corset bodice, full skirt with deep rounded pumpkin-rib pleats, floor length' },
      { slot: 'accessory', name: 'Vine headpiece', color: 'Moss green', colorHex: '#556B2F', material: 'Silk leaves and wire', fit: 'Twisting vine with leaves and a curling tendril' },
      { slot: 'accessory', name: 'Opera gloves', color: 'Moss green', colorHex: '#4F6B34', material: 'Satin', fit: 'Above the elbow' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Moss green', colorHex: '#4A6230', material: 'Satin', fit: 'Mid heel' },
    ],
  },
  {
    id: 'hw-glowing-jellyfish', presentation: 'womenswear', name: 'Glowing Jellyfish', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${GRETA}/jellyfish.png`,
    scene: 'a dark room lit only by the costume',
    description: 'A clear umbrella dripping with glowing strands: the brightest thing at the party.',
    items: [
      { slot: 'accessory', name: 'Jellyfish umbrella', color: 'Clear', colorHex: '#E8F1F8', material: 'Clear vinyl with LED fairy lights', fit: 'Bubble umbrella with glowing light strands and iridescent ribbons hanging to the knees' },
      { slot: 'dress', name: 'Slip dress', color: 'Iridescent pale blue', colorHex: '#BFD8EA', material: 'Iridescent satin', fit: 'Bias cut, thin straps, asymmetric handkerchief hem' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Clear', colorHex: '#E6EEF2', material: 'Clear vinyl', fit: 'Block heel' },
    ],
  },
  {
    id: 'hw-disco-ball', presentation: 'womenswear', name: 'Human Disco Ball', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${GRETA}/discoball.png`,
    scene: 'a dark apartment Halloween party, shot with the phone flash',
    description: 'Mirror tiles head to toe: every flash turns into a light show.',
    items: [
      { slot: 'dress', name: 'Mirror-tile mini dress', color: 'Silver', colorHex: '#C9CDD2', material: 'Mirror tiles on mesh', fit: 'Fitted, square neck, thin straps' },
      { slot: 'accessory', name: 'Mirror-tile headband', color: 'Silver', colorHex: '#C0C4C9', material: 'Mirror tiles', fit: 'Padded' },
      { slot: 'shoes', name: 'Strappy heels', color: 'Silver', colorHex: '#BFC3C8', material: 'Metallic leather', fit: 'Thin straps, stiletto' },
    ],
  },
  {
    id: 'hw-deaths-head-moth', presentation: 'womenswear', name: "Death's-Head Moth", era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${GRETA}/moth.png`,
    scene: 'a candlelit living room at night',
    description: 'Dusty wings that open wide, velvet and fur: eerie and beautiful.',
    items: [
      { slot: 'outerwear', name: 'Moth-wing cape', color: 'Dusty taupe', colorHex: '#A89880', material: 'Painted chiffon', fit: 'Wing panels with dark eye spots, attached at the wrists' },
      { slot: 'accessory', name: 'Faux-fur collar', color: 'Ivory', colorHex: '#EFE6D6', material: 'Faux fur', fit: 'Fluffy shoulder stole' },
      { slot: 'dress', name: 'Velvet slip dress', color: 'Dusty brown', colorHex: '#5A3E33', material: 'Velvet', fit: 'Midi, cowl neck, side slit' },
      { slot: 'accessory', name: 'Antennae headband', color: 'Taupe', colorHex: '#8A7660', material: 'Feathers', fit: 'Feathery antennae' },
      { slot: 'shoes', name: 'Slouchy knee boots', color: 'Chocolate', colorHex: '#3E2A22', material: 'Suede', fit: 'Block heel' },
    ],
  },
  {
    id: 'hw-melting-candle', presentation: 'womenswear', name: 'Melting Candle', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${GRETA}/candle.png`,
    scene: 'a dark room lit by a cluster of candles',
    description: 'Wax drips and a little flame on top: quietly haunting.',
    items: [
      { slot: 'dress', name: 'Column gown', color: 'Ivory', colorHex: '#F1EAD8', material: 'Crepe with sculpted wax drips', fit: 'Floor length, drips running from the shoulders and pooling at the hem' },
      { slot: 'accessory', name: 'Flame headpiece', color: 'Warm gold', colorHex: '#F2B33D', material: 'LED and silk', fit: 'A small glowing flame on top of the head' },
      { slot: 'shoes', name: 'Pumps', color: 'Ivory', colorHex: '#EFE7D6', material: 'Satin', fit: 'Pointed toe' },
    ],
  },
  {
    id: 'hw-medusa', presentation: 'womenswear', name: 'Medusa', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${GRETA}/medusa.png`,
    scene: 'a dim hallway lit by a lamp and candles',
    description: 'A crown of coiling snakes and a stone-grey Grecian gown. Don’t look her in the eye.',
    items: [
      { slot: 'accessory', name: 'Snake headpiece', color: 'Green and gold', colorHex: '#7A8A3A', material: 'Sculpted resin snakes', fit: 'Dozens of coiling snakes around the head' },
      { slot: 'dress', name: 'Draped Grecian gown', color: 'Stone grey', colorHex: '#8E8A80', material: 'Washed silk', fit: 'Deep V, gathered waist, thigh slit, floor length' },
      { slot: 'accessory', name: 'Arm cuffs', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'An upper-arm cuff and a wrist cuff' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Gold', colorHex: '#C8A24A', material: 'Leather', fit: 'Flat' },
    ],
  },
  {
    id: 'hw-spider-queen', presentation: 'womenswear', name: 'Spider Web Gown', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${GRETA}/spider.png`,
    scene: 'a dark living room with string lights',
    description: 'Black lace and a web that reaches the floor: a silhouette you can see from across the room.',
    items: [
      { slot: 'dress', name: 'Lace gown', color: 'Black', colorHex: '#141414', material: 'Lace', fit: 'Fitted, high neck, long sleeves, floor length' },
      { slot: 'outerwear', name: 'Spiderweb cape', color: 'Ivory', colorHex: '#E9E2D3', material: 'Knotted rope', fit: 'A huge web from the wrists and shoulders to the floor' },
      { slot: 'accessory', name: 'Spider hair clips', color: 'Black', colorHex: '#111111', material: 'Resin', fit: 'Large spiders' },
      { slot: 'shoes', name: 'Pointed heels', color: 'Black', colorHex: '#161616', material: 'Leather', fit: 'Stiletto' },
    ],
  },
  {
    id: 'hw-black-swan', presentation: 'womenswear', name: 'Dark Ballerina', era: HALLOWEEN, mood: 'Costume party', person: 'ava',
    scene: 'a dim theater hallway with velvet curtains',
    description: 'Feathers, tulle and a dark crown: a ballerina with a twist.',
    items: [
      { slot: 'dress', name: 'Feathered tutu dress', color: 'Black', colorHex: '#121212', material: 'Tulle and feathers', fit: 'Strapless corset bodice, layered tutu skirt to the knee' },
      { slot: 'accessory', name: 'Feather crown', color: 'Black', colorHex: '#151515', material: 'Feathers', fit: 'A crown of black feathers' },
      { slot: 'shoes', name: 'Ballet flats', color: 'Black', colorHex: '#1A1A1A', material: 'Satin', fit: 'Ribbons laced up the ankle' },
    ],
  },
  {
    id: 'hw-vampire-countess', presentation: 'womenswear', name: 'Vampire Countess', era: HALLOWEEN, mood: 'Costume party', person: 'sofia',
    scene: 'an old stone staircase lit by candelabras',
    description: 'Blood-red velvet and a high-collared cape: gothic glamour.',
    items: [
      { slot: 'dress', name: 'Velvet gown', color: 'Blood red', colorHex: '#7A0E1A', material: 'Velvet', fit: 'Corset bodice, long sleeves, floor length' },
      { slot: 'outerwear', name: 'High-collar cape', color: 'Black', colorHex: '#121212', material: 'Velvet with red lining', fit: 'Floor length, standing collar' },
      { slot: 'accessory', name: 'Choker', color: 'Black', colorHex: '#151515', material: 'Velvet with a red stone', fit: 'Close to the neck' },
      { slot: 'shoes', name: 'Pointed ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Stiletto' },
    ],
  },
  {
    id: 'hw-ghost-bride', presentation: 'womenswear', name: 'Victorian Ghost', era: HALLOWEEN, mood: 'Costume party', person: 'helen',
    scene: 'a foggy garden at night with a lantern',
    description: 'Tattered lace, a torn veil and a dried bouquet: romantic and chilling.',
    items: [
      { slot: 'dress', name: 'Tattered lace gown', color: 'Ivory', colorHex: '#ECE6DA', material: 'Lace', fit: 'Long sleeves, frayed layered hem, floor length' },
      { slot: 'accessory', name: 'Long veil', color: 'Ivory', colorHex: '#F2EDE3', material: 'Torn tulle', fit: 'Cathedral length' },
      { slot: 'accessory', name: 'Dried rose bouquet', color: 'Dusty rose', colorHex: '#9C6F6A', material: 'Dried flowers', fit: 'Held in hand' },
      { slot: 'shoes', name: 'Lace-up boots', color: 'Ivory', colorHex: '#E8E1D3', material: 'Leather', fit: 'Victorian, small heel' },
    ],
  },
  {
    id: 'hw-autumn-fairy', presentation: 'womenswear', name: 'Autumn Fairy', era: HALLOWEEN, mood: 'Costume party', person: 'imani',
    scene: 'a backyard party at night with fairy lights in the trees',
    description: 'A corset of autumn leaves, little amber wings and a berry crown.',
    items: [
      { slot: 'dress', name: 'Leaf corset dress', color: 'Rust and gold', colorHex: '#B4542A', material: 'Silk leaves on tulle', fit: 'Corset bodice covered in autumn leaves, short tulle skirt' },
      { slot: 'accessory', name: 'Fairy wings', color: 'Amber', colorHex: '#D9A55B', material: 'Iridescent organza', fit: 'Small wings on the back' },
      { slot: 'accessory', name: 'Leaf and berry crown', color: 'Copper', colorHex: '#B86F32', material: 'Dried leaves and berries', fit: 'Woven crown' },
      { slot: 'shoes', name: 'Lace-up sandals', color: 'Bronze', colorHex: '#8C6239', material: 'Leather', fit: 'Flat, ribbons to the calf' },
    ],
  },
  {
    id: 'hw-skeleton-couture', presentation: 'womenswear', name: 'Skeleton Couture', era: HALLOWEEN, mood: 'Costume party', person: 'mei',
    scene: 'a dark rooftop party with city lights behind',
    description: 'A black gown with a crystal-beaded ribcage: the chicest skeleton in town.',
    items: [
      { slot: 'dress', name: 'Beaded skeleton gown', color: 'Black and silver', colorHex: '#1C1C1C', material: 'Sequins and crystal beading', fit: 'Fitted, floor length, a silver ribcage and spine beaded on black' },
      { slot: 'accessory', name: 'Opera gloves', color: 'Black', colorHex: '#121212', material: 'Satin', fit: 'Above the elbow' },
      { slot: 'shoes', name: 'Pointed heels', color: 'Silver', colorHex: '#BFC3C8', material: 'Metallic leather', fit: 'Stiletto' },
    ],
  },
  {
    id: 'hw-sea-siren', presentation: 'womenswear', name: 'Sea Siren', era: HALLOWEEN, mood: 'Costume party', person: 'nora',
    scene: 'a dark party lit in blue and green',
    description: 'Iridescent sequins, a fishtail hem and a crown of pearls and shells.',
    items: [
      { slot: 'dress', name: 'Mermaid gown', color: 'Iridescent teal', colorHex: '#2E8B8B', material: 'Sequins', fit: 'Fitted to the knee, flared fishtail hem' },
      { slot: 'accessory', name: 'Pearl and shell crown', color: 'Pearl white', colorHex: '#F1ECE2', material: 'Pearls and shells', fit: 'Crown' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Silver', colorHex: '#C0C4C9', material: 'Metallic leather', fit: 'Low heel' },
    ],
  },
  {
    id: 'hw-egyptian-queen', presentation: 'womenswear', name: 'Egyptian Queen', era: HALLOWEEN, mood: 'Costume party', person: 'ava',
    scene: 'a warmly lit hall with tall columns at night',
    description: 'Pleated white linen, a broad gold collar and a cobra crown.',
    items: [
      { slot: 'dress', name: 'Pleated column gown', color: 'White', colorHex: '#F4F1EA', material: 'Pleated linen', fit: 'Floor length, one shoulder' },
      { slot: 'accessory', name: 'Broad collar necklace', color: 'Gold and turquoise', colorHex: '#C9A44C', material: 'Metal with turquoise beads', fit: 'A wide collar over the shoulders' },
      { slot: 'accessory', name: 'Cobra crown', color: 'Gold', colorHex: '#C8A24A', material: 'Metal', fit: 'A slim band with a cobra at the front' },
      { slot: 'shoes', name: 'Thong sandals', color: 'Gold', colorHex: '#C8A24A', material: 'Leather', fit: 'Flat' },
    ],
  },
  {
    id: 'hw-venus-flytrap', presentation: 'womenswear', name: 'Venus Flytrap', era: HALLOWEEN, mood: 'Costume party', person: 'sofia',
    scene: 'a dark greenhouse at night with string lights',
    description: 'A green corset gown and giant flytrap jaws framing her face.',
    items: [
      { slot: 'dress', name: 'Corset gown', color: 'Leaf green', colorHex: '#3F7A3A', material: 'Satin', fit: 'Corset bodice, column skirt' },
      { slot: 'accessory', name: 'Flytrap collar', color: 'Lime and red', colorHex: '#8DB33A', material: 'Sculpted foam and felt', fit: 'Giant flytrap jaws with soft teeth framing the face' },
      { slot: 'accessory', name: 'Opera gloves', color: 'Leaf green', colorHex: '#3F7A3A', material: 'Satin', fit: 'Above the elbow' },
      { slot: 'shoes', name: 'Pumps', color: 'Leaf green', colorHex: '#3E7838', material: 'Satin', fit: 'Pointed toe' },
    ],
  },
  {
    id: 'hw-modern-witch', presentation: 'womenswear', name: 'Modern Witch', era: HALLOWEEN, mood: 'Costume party', person: 'helen',
    scene: 'a moody apartment party with candles and dried flowers',
    description: 'The classic witch, done like a fashion week guest: satin, chiffon and a sharp hat.',
    items: [
      { slot: 'accessory', name: 'Witch hat', color: 'Black', colorHex: '#141414', material: 'Wool felt', fit: 'Tall pointed crown, wide brim' },
      { slot: 'dress', name: 'Slip dress', color: 'Black', colorHex: '#151515', material: 'Satin', fit: 'Midi, bias cut' },
      { slot: 'outerwear', name: 'Sheer duster', color: 'Black', colorHex: '#1A1A1A', material: 'Chiffon', fit: 'Ankle length, worn open' },
      { slot: 'accessory', name: 'Layered necklaces', color: 'Silver', colorHex: '#C0C4C9', material: 'Metal', fit: 'Moon and star pendants' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Pointed, block heel' },
    ],
  },
  {
    id: 'hw-ice-queen', presentation: 'womenswear', name: 'Snow Queen', era: HALLOWEEN, mood: 'Costume party', person: 'imani',
    scene: 'a dark party lit in cold blue light',
    description: 'Icy sequins, a crystal cape and a crown of icicles.',
    items: [
      { slot: 'dress', name: 'Sequin gown', color: 'Icy blue', colorHex: '#BFD9EC', material: 'Sequins', fit: 'Long sleeves, floor length' },
      { slot: 'outerwear', name: 'Snowflake cape', color: 'Ice white', colorHex: '#EEF4F8', material: 'Organza with crystal snowflakes', fit: 'Floor length from the shoulders' },
      { slot: 'accessory', name: 'Icicle crown', color: 'Silver', colorHex: '#D8DDE2', material: 'Crystals', fit: 'Tall icicle spikes' },
      { slot: 'shoes', name: 'Pumps', color: 'Silver', colorHex: '#C9CED3', material: 'Metallic leather', fit: 'Pointed' },
    ],
  },
  {
    id: 'hw-queen-of-hearts', presentation: 'womenswear', name: 'Queen of Hearts', era: HALLOWEEN, mood: 'Costume party', person: 'mei',
    scene: 'a dark hallway with red light and playing cards on the floor',
    description: 'A red heart bodice, a ruffled collar and a little crown. Off with their heads.',
    items: [
      { slot: 'dress', name: 'Heart-bodice gown', color: 'Red', colorHex: '#B3121E', material: 'Satin', fit: 'Heart-shaped bodice, full skirt with black and white panels' },
      { slot: 'accessory', name: 'Ruffled collar', color: 'White', colorHex: '#F2F0EA', material: 'Tulle', fit: 'A standing Elizabethan collar' },
      { slot: 'accessory', name: 'Heart crown', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Small, heart-topped' },
      { slot: 'shoes', name: 'Pumps', color: 'Black', colorHex: '#141414', material: 'Patent leather', fit: 'Pointed' },
    ],
  },
  {
    id: 'hw-scarecrow-chic', presentation: 'womenswear', name: 'Scarecrow Chic', era: HALLOWEEN, mood: 'Costume party', person: 'nora',
    scene: 'a barn party at night with hay bales and string lights',
    description: 'Flannel, denim and a straw hat: the easiest costume that still looks styled.',
    items: [
      { slot: 'top', name: 'Plaid shirt', color: 'Rust plaid', colorHex: '#A0522D', material: 'Flannel', fit: 'Knotted at the waist, sleeves rolled' },
      { slot: 'bottom', name: 'Overall shorts', color: 'Mid blue', colorHex: '#5B7FA6', material: 'Denim', fit: 'Straps over the shirt' },
      { slot: 'accessory', name: 'Straw hat', color: 'Natural straw', colorHex: '#D8B878', material: 'Straw', fit: 'Wide brim with raffia poking out' },
      { slot: 'shoes', name: 'Lace-up ankle boots', color: 'Cognac', colorHex: '#9A5B2E', material: 'Leather', fit: 'Low block heel' },
    ],
  },
  {
    id: 'hw-mummy-glam', presentation: 'womenswear', name: 'Mummy Glam', era: HALLOWEEN, mood: 'Costume party', person: 'ava',
    scene: 'a dark museum hall with stone statues, warm spotlights and guests in costumes',
    description: 'A gown of wound, frayed gauze, wrapped arms and a gold scarab: a mummy, but make it couture.',
    items: [
      { slot: 'dress', name: 'Wrapped gauze gown', color: 'Antique ivory', colorHex: '#E8DFCC', material: 'Layered cotton gauze strips', fit: 'Strips wound around the body from bust to floor, frayed ends trailing loose, fitted to a flared hem' },
      { slot: 'accessory', name: 'Head wrap', color: 'Antique ivory', colorHex: '#E8DFCC', material: 'Cotton gauze', fit: 'Wound loosely over the hair, face fully visible, a few loose ends' },
      { slot: 'accessory', name: 'Arm wraps', color: 'Antique ivory', colorHex: '#E8DFCC', material: 'Cotton gauze', fit: 'Wound from the fingers to the shoulders, loose ends' },
      { slot: 'accessory', name: 'Scarab amulet', color: 'Antique gold', colorHex: '#B08D3C', material: 'Metal', fit: 'Pendant on a short chain' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Gold', colorHex: '#C9A24A', material: 'Metallic leather', fit: 'Thin straps, low heel' },
    ],
  },
  // Menswear.
  {
    id: 'hm-vampire-count', presentation: 'menswear', name: 'Vampire Count', era: HALLOWEEN, mood: 'Costume party', person: 'marcus',
    scene: 'an old stone staircase lit by candelabras',
    description: 'A velvet tuxedo, a ruffled shirt and a red-lined cape.',
    items: [
      { slot: 'suit', name: 'Velvet tuxedo', color: 'Black', colorHex: '#121212', material: 'Velvet', fit: 'Slim, peak lapels' },
      { slot: 'top', name: 'Ruffled shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton', fit: 'Jabot front' },
      { slot: 'outerwear', name: 'Cape', color: 'Black', colorHex: '#121212', material: 'Wool with red satin lining', fit: 'Floor length, standing collar' },
      { slot: 'shoes', name: 'Oxfords', color: 'Black', colorHex: '#151515', material: 'Patent leather', fit: 'Classic' },
    ],
  },
  {
    id: 'hm-mad-hatter', presentation: 'menswear', name: 'Mad Hatter', era: HALLOWEEN, mood: 'Costume party', person: 'kenji',
    scene: 'a whimsical tea party table at night with candles',
    description: 'A plum tailcoat, a brocade waistcoat and a tall hat.',
    items: [
      { slot: 'outerwear', name: 'Tailcoat', color: 'Plum', colorHex: '#5B2A4A', material: 'Velvet', fit: 'Long, fitted' },
      { slot: 'layer', name: 'Brocade waistcoat', color: 'Mustard', colorHex: '#C59A3A', material: 'Brocade', fit: 'Buttoned' },
      { slot: 'bottom', name: 'Striped trousers', color: 'Black and grey', colorHex: '#4A4A4A', material: 'Wool', fit: 'Slim' },
      { slot: 'accessory', name: 'Top hat', color: 'Mustard and plum', colorHex: '#8A5A3A', material: 'Felt', fit: 'Tall, with a ribbon band' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#151515', material: 'Leather', fit: 'Pointed' },
    ],
  },
  {
    id: 'hm-pirate-captain', presentation: 'menswear', name: 'Pirate Captain', era: HALLOWEEN, mood: 'Costume party', person: 'diego',
    scene: 'a dark harbor-side bar at night with lanterns',
    description: 'A long navy coat with brass buttons, knee boots and a tricorn hat.',
    items: [
      { slot: 'outerwear', name: 'Captain coat', color: 'Navy', colorHex: '#1F2A44', material: 'Wool', fit: 'Knee length, brass buttons, cuffed sleeves' },
      { slot: 'top', name: 'Billowy shirt', color: 'Ivory', colorHex: '#EFE8DA', material: 'Linen', fit: 'Lace-up neck' },
      { slot: 'bottom', name: 'Slim trousers', color: 'Black', colorHex: '#1B1B1D', material: 'Cotton', fit: 'Tucked into the boots' },
      { slot: 'shoes', name: 'Knee boots', color: 'Brown', colorHex: '#5A3A22', material: 'Leather', fit: 'Cuffed at the top' },
      { slot: 'accessory', name: 'Tricorn hat', color: 'Black', colorHex: '#161616', material: 'Felt', fit: 'Classic' },
    ],
  },
  {
    id: 'hm-greek-god', presentation: 'menswear', name: 'Greek God', era: HALLOWEEN, mood: 'Costume party', person: 'arjun',
    scene: 'a warmly lit hall with tall columns at night',
    description: 'A linen tunic, a gold-trimmed mantle and a laurel crown.',
    items: [
      { slot: 'top', name: 'Linen tunic', color: 'White', colorHex: '#F4F1EA', material: 'Linen', fit: 'Knee length, belted' },
      { slot: 'outerwear', name: 'Draped mantle', color: 'White with gold trim', colorHex: '#EFE8D8', material: 'Linen', fit: 'Over one shoulder' },
      { slot: 'accessory', name: 'Laurel crown', color: 'Gold', colorHex: '#C9A44C', material: 'Metal leaves', fit: 'Classic' },
      { slot: 'shoes', name: 'Lace-up sandals', color: 'Tan', colorHex: '#A87C50', material: 'Leather', fit: 'Laced to the calf' },
    ],
  },
  {
    id: 'hm-scarecrow', presentation: 'menswear', name: 'Scarecrow', era: HALLOWEEN, mood: 'Costume party', person: 'liam',
    scene: 'a barn party at night with hay bales and string lights',
    description: 'Flannel, denim overalls and a straw hat.',
    items: [
      { slot: 'top', name: 'Plaid shirt', color: 'Rust plaid', colorHex: '#A0522D', material: 'Flannel', fit: 'Sleeves rolled' },
      { slot: 'bottom', name: 'Overalls', color: 'Mid blue', colorHex: '#5B7FA6', material: 'Denim', fit: 'Relaxed' },
      { slot: 'accessory', name: 'Straw hat', color: 'Natural straw', colorHex: '#D8B878', material: 'Straw', fit: 'Wide brim with raffia poking out' },
      { slot: 'shoes', name: 'Work boots', color: 'Brown', colorHex: '#6B4A2F', material: 'Leather', fit: 'Lace-up' },
    ],
  },
  {
    id: 'hm-masquerade', presentation: 'menswear', name: 'Masquerade Gentleman', era: HALLOWEEN, mood: 'Costume party', person: 'erik',
    scene: 'a grand ballroom party at night with chandeliers',
    description: 'A midnight tuxedo and a gilded mask in hand.',
    items: [
      { slot: 'suit', name: 'Tuxedo', color: 'Midnight navy', colorHex: '#1B2236', material: 'Wool', fit: 'Slim, satin lapels' },
      { slot: 'top', name: 'Dress shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton', fit: 'Classic collar' },
      { slot: 'accessory', name: 'Masquerade mask', color: 'Gold', colorHex: '#C9A44C', material: 'Lacquered papier-mâché', fit: 'Held in hand' },
      { slot: 'shoes', name: 'Oxfords', color: 'Black', colorHex: '#151515', material: 'Patent leather', fit: 'Classic' },
    ],
  },
]

const fall: EditLook[] = [
  {
    id: 'fall-pumpkin-patch', presentation: 'womenswear', name: 'Pumpkin Patch', era: FALL, mood: 'Pumpkin patch', person: 'ava',
    scene: 'a pumpkin patch on a sunny fall afternoon, hay bales and pumpkins around',
    description: 'A chunky cream knit, light jeans and suede boots: the pumpkin patch classic.',
    items: [
      { slot: 'top', name: 'Cable-knit sweater', color: 'Cream', colorHex: '#EFE6D2', material: 'Wool', fit: 'Chunky, relaxed' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Light wash', colorHex: '#9DB4CC', material: 'Denim', fit: 'High-waisted, ankle length' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Chocolate', colorHex: '#4A3022', material: 'Suede', fit: 'Block heel' },
      { slot: 'accessory', name: 'Blanket scarf', color: 'Camel plaid', colorHex: '#B08A5E', material: 'Wool', fit: 'Wrapped loosely' },
    ],
  },
  {
    id: 'fall-apple-picking', presentation: 'womenswear', name: 'Apple Picking', era: FALL, mood: 'Apple orchard', person: 'sofia',
    scene: 'an apple orchard on a crisp fall morning',
    description: 'Buffalo check, a quilted vest and duck boots for a day in the orchard.',
    items: [
      { slot: 'layer', name: 'Buffalo-check shirt', color: 'Red and black', colorHex: '#A3242B', material: 'Flannel', fit: 'Worn open' },
      { slot: 'top', name: 'Crew-neck T-shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton jersey', fit: 'Regular' },
      { slot: 'outerwear', name: 'Quilted vest', color: 'Olive', colorHex: '#5B6342', material: 'Nylon', fit: 'Regular' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Mid wash', colorHex: '#6E86A6', material: 'Denim', fit: 'High-waisted' },
      { slot: 'shoes', name: 'Duck boots', color: 'Brown and navy', colorHex: '#6B4A2F', material: 'Leather and rubber', fit: 'Lace-up' },
    ],
  },
  {
    id: 'fall-game-day', presentation: 'womenswear', name: 'Game Day', era: FALL, mood: 'Football Saturday', person: 'helen',
    scene: 'a college football tailgate in a parking lot on a sunny fall day, no logos anywhere',
    description: 'A varsity-style cardigan, jeans and white sneakers. Cheer in style.',
    items: [
      { slot: 'layer', name: 'Varsity cardigan', color: 'Maroon', colorHex: '#6B1F2A', material: 'Wool knit', fit: 'Oversized, cream stripe trim, no letters' },
      { slot: 'top', name: 'Crew-neck T-shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton jersey', fit: 'Regular' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Mid wash', colorHex: '#6E86A6', material: 'Denim', fit: 'High-waisted' },
      { slot: 'shoes', name: 'Sneakers', color: 'White', colorHex: '#F2F2EF', material: 'Leather', fit: 'Low top' },
    ],
  },
  {
    id: 'fall-leaf-peeping', presentation: 'womenswear', name: 'Leaf Peeping', era: FALL, mood: 'New England weekend', person: 'imani',
    scene: 'a New England village street with bright red and orange fall foliage',
    description: 'A camel coat, an oatmeal turtleneck and a rust beret among the maples.',
    items: [
      { slot: 'outerwear', name: 'Long wool coat', color: 'Camel', colorHex: '#B98B5E', material: 'Wool', fit: 'Straight, below the knee' },
      { slot: 'top', name: 'Turtleneck', color: 'Oatmeal', colorHex: '#D8CBB4', material: 'Merino', fit: 'Fitted' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Dark wash', colorHex: '#2E3B55', material: 'Denim', fit: 'High-waisted' },
      { slot: 'shoes', name: 'Knee boots', color: 'Cognac', colorHex: '#9A5B2E', material: 'Leather', fit: 'Flat' },
      { slot: 'accessory', name: 'Beret', color: 'Rust', colorHex: '#9C4A2A', material: 'Wool felt', fit: 'Classic' },
    ],
  },
  {
    id: 'fall-wedding-guest', presentation: 'womenswear', name: 'Fall Wedding Guest', era: FALL, mood: 'Barn wedding', person: 'mei',
    scene: 'a rustic barn wedding at golden hour',
    description: 'Rust satin, a tan blazer on the shoulders and gold heels.',
    items: [
      { slot: 'dress', name: 'Satin slip dress', color: 'Rust', colorHex: '#A4472A', material: 'Satin', fit: 'Midi, bias cut' },
      { slot: 'outerwear', name: 'Cropped blazer', color: 'Tan', colorHex: '#C9A27A', material: 'Wool', fit: 'Draped over the shoulders' },
      { slot: 'shoes', name: 'Strappy heels', color: 'Gold', colorHex: '#C9A44C', material: 'Metallic leather', fit: 'Mid heel' },
      { slot: 'bag', name: 'Clutch', color: 'Gold', colorHex: '#C8A24A', material: 'Metallic leather', fit: 'Small' },
    ],
  },
  {
    id: 'fall-coffee-run', presentation: 'womenswear', name: 'Coffee Run', era: FALL, mood: 'City morning', person: 'nora',
    scene: 'a city sidewalk outside a coffee shop on a fall morning, coffee in hand',
    description: 'A chocolate leather jacket over cream ribs and charcoal wide-legs.',
    items: [
      { slot: 'outerwear', name: 'Leather jacket', color: 'Chocolate', colorHex: '#4A3022', material: 'Leather', fit: 'Relaxed, hip length' },
      { slot: 'top', name: 'Ribbed knit', color: 'Cream', colorHex: '#EDE4D3', material: 'Cotton rib', fit: 'Fitted' },
      { slot: 'bottom', name: 'Wide-leg trousers', color: 'Charcoal', colorHex: '#3C3C3E', material: 'Wool blend', fit: 'High-waisted' },
      { slot: 'shoes', name: 'Loafers', color: 'Black', colorHex: '#161616', material: 'Leather', fit: 'Chunky sole' },
      { slot: 'bag', name: 'Tote', color: 'Tan', colorHex: '#B08A5E', material: 'Leather', fit: 'Large' },
    ],
  },
  {
    id: 'fall-friendsgiving', presentation: 'womenswear', name: 'Friendsgiving', era: FALL, mood: 'Friendsgiving dinner', person: 'ava',
    scene: 'a cozy dining room set for a Friendsgiving dinner with candles',
    description: 'An olive knit dress, brown boots and gold hoops: easy and warm.',
    items: [
      { slot: 'dress', name: 'Knit midi dress', color: 'Olive', colorHex: '#6B6B3A', material: 'Rib knit', fit: 'Fitted, long sleeves' },
      { slot: 'shoes', name: 'Knee boots', color: 'Brown', colorHex: '#5A3A22', material: 'Leather', fit: 'Block heel' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Medium' },
    ],
  },
  {
    id: 'fall-date-night', presentation: 'womenswear', name: 'Fall Date Night', era: FALL, mood: 'Wine bar date', person: 'sofia',
    scene: 'a cozy wine bar at night',
    description: 'A black turtleneck and a burgundy satin skirt: simple and a little dramatic.',
    items: [
      { slot: 'top', name: 'Turtleneck', color: 'Black', colorHex: '#151515', material: 'Fine knit', fit: 'Fitted' },
      { slot: 'bottom', name: 'Satin midi skirt', color: 'Burgundy', colorHex: '#6E1E2E', material: 'Satin', fit: 'Bias cut' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Pointed, block heel' },
      { slot: 'bag', name: 'Shoulder bag', color: 'Black', colorHex: '#161616', material: 'Leather', fit: 'Small' },
    ],
  },
  {
    id: 'fall-office', presentation: 'womenswear', name: 'Fall at the Office', era: FALL, mood: 'Office', person: 'helen',
    scene: 'a bright office lobby in the morning',
    description: 'A camel blazer, an ivory silk blouse and chocolate wide-legs.',
    items: [
      { slot: 'outerwear', name: 'Blazer', color: 'Camel', colorHex: '#B98B5E', material: 'Wool', fit: 'Relaxed, single-breasted' },
      { slot: 'top', name: 'Silk blouse', color: 'Ivory', colorHex: '#F1EAD8', material: 'Silk', fit: 'Tucked in' },
      { slot: 'bottom', name: 'Wide-leg trousers', color: 'Chocolate', colorHex: '#4A3022', material: 'Wool crepe', fit: 'High-waisted, pressed crease' },
      { slot: 'shoes', name: 'Loafers', color: 'Dark brown', colorHex: '#3E2A22', material: 'Leather', fit: 'Classic' },
      { slot: 'bag', name: 'Structured tote', color: 'Black', colorHex: '#161616', material: 'Leather', fit: 'Medium' },
    ],
  },
  {
    id: 'fall-farmers-market', presentation: 'womenswear', name: 'Farmers Market', era: FALL, mood: 'Saturday market', person: 'imani',
    scene: 'a farmers market with squash and flowers on a sunny fall morning',
    description: 'A mustard cardigan, a white tee and a straw market basket.',
    items: [
      { slot: 'layer', name: 'Chunky cardigan', color: 'Mustard', colorHex: '#C9962E', material: 'Wool', fit: 'Relaxed' },
      { slot: 'top', name: 'Crew-neck T-shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton jersey', fit: 'Regular' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Mid wash', colorHex: '#6E86A6', material: 'Denim', fit: 'High-waisted' },
      { slot: 'shoes', name: 'Loafers', color: 'Tan', colorHex: '#A87C50', material: 'Suede', fit: 'Classic' },
      { slot: 'bag', name: 'Market basket', color: 'Natural straw', colorHex: '#D8B878', material: 'Straw', fit: 'Carried on the arm' },
    ],
  },
  {
    id: 'fall-hayride', presentation: 'womenswear', name: 'Hayride', era: FALL, mood: 'Farm hayride', person: 'mei',
    scene: 'a farm with a hay wagon at golden hour',
    description: 'A tartan shirt dress, a denim jacket and knee boots.',
    items: [
      { slot: 'dress', name: 'Shirt dress', color: 'Green tartan', colorHex: '#3E5A3A', material: 'Flannel', fit: 'Belted, knee length' },
      { slot: 'outerwear', name: 'Denim jacket', color: 'Mid wash', colorHex: '#6E86A6', material: 'Denim', fit: 'Regular' },
      { slot: 'shoes', name: 'Knee boots', color: 'Brown', colorHex: '#5A3A22', material: 'Leather', fit: 'Flat' },
    ],
  },
  {
    id: 'fall-sunday-home', presentation: 'womenswear', name: 'Sunday at Home', era: FALL, mood: 'Cozy Sunday', person: 'nora',
    scene: 'a cozy living room on a rainy fall afternoon',
    description: 'A matching oatmeal knit set and shearling slippers. Nowhere to be.',
    items: [
      { slot: 'top', name: 'Knit sweater', color: 'Oatmeal', colorHex: '#D8CBB4', material: 'Cashmere blend', fit: 'Relaxed' },
      { slot: 'bottom', name: 'Knit wide-leg pants', color: 'Oatmeal', colorHex: '#D8CBB4', material: 'Cashmere blend', fit: 'Relaxed' },
      { slot: 'shoes', name: 'Shearling slippers', color: 'Tan', colorHex: '#B08A5E', material: 'Suede and shearling', fit: 'Slip-on' },
    ],
  },
  {
    id: 'fall-classic-trench', presentation: 'womenswear', name: 'The Classic Trench', era: FALL, mood: 'City weekend', person: 'ava',
    scene: 'a tree-lined city street with falling leaves',
    description: 'A beige trench, a striped top and ballet flats: forever.',
    items: [
      { slot: 'outerwear', name: 'Trench coat', color: 'Beige', colorHex: '#CDB892', material: 'Cotton gabardine', fit: 'Belted, below the knee' },
      { slot: 'top', name: 'Striped top', color: 'Navy and white', colorHex: '#2B3A55', material: 'Cotton jersey', fit: 'Boat neck' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Mid wash', colorHex: '#6E86A6', material: 'Denim', fit: 'Cropped at the ankle' },
      { slot: 'shoes', name: 'Ballet flats', color: 'Black', colorHex: '#161616', material: 'Leather', fit: 'Classic' },
    ],
  },
  {
    id: 'fall-vineyard', presentation: 'womenswear', name: 'Vineyard Harvest', era: FALL, mood: 'Wine country', person: 'sofia',
    scene: 'a vineyard at harvest time on a golden afternoon',
    description: 'A cream turtleneck, a chocolate suede skirt and cognac boots.',
    items: [
      { slot: 'top', name: 'Turtleneck', color: 'Cream', colorHex: '#EDE4D3', material: 'Merino', fit: 'Fitted' },
      { slot: 'bottom', name: 'Suede midi skirt', color: 'Chocolate', colorHex: '#4A3022', material: 'Suede', fit: 'A-line' },
      { slot: 'shoes', name: 'Knee boots', color: 'Cognac', colorHex: '#9A5B2E', material: 'Leather', fit: 'Block heel' },
    ],
  },
  {
    id: 'fall-museum-day', presentation: 'womenswear', name: 'Museum Day', era: FALL, mood: 'Museum afternoon', person: 'helen',
    scene: 'a bright museum hall with big paintings on the walls',
    description: 'A charcoal coat, a black turtleneck and grey plaid trousers.',
    items: [
      { slot: 'outerwear', name: 'Wool coat', color: 'Charcoal', colorHex: '#3C3C3E', material: 'Wool', fit: 'Straight, knee length' },
      { slot: 'top', name: 'Turtleneck', color: 'Black', colorHex: '#151515', material: 'Merino', fit: 'Fitted' },
      { slot: 'bottom', name: 'Plaid trousers', color: 'Grey plaid', colorHex: '#7A7A78', material: 'Wool', fit: 'Straight, high-waisted' },
      { slot: 'shoes', name: 'Loafers', color: 'Black', colorHex: '#161616', material: 'Leather', fit: 'Classic' },
    ],
  },
  {
    id: 'fall-city-weekend', presentation: 'womenswear', name: 'City Weekend', era: FALL, mood: 'Downtown weekend', person: 'imani',
    scene: 'a downtown street with brick buildings on a fall afternoon',
    description: 'A black leather blazer, a grey knit and dark denim.',
    items: [
      { slot: 'outerwear', name: 'Leather blazer', color: 'Black', colorHex: '#151515', material: 'Leather', fit: 'Relaxed' },
      { slot: 'top', name: 'Fine knit', color: 'Grey', colorHex: '#8A8A88', material: 'Merino', fit: 'Crew neck' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Dark wash', colorHex: '#2E3B55', material: 'Denim', fit: 'High-waisted' },
      { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Block heel' },
      { slot: 'bag', name: 'Shoulder bag', color: 'Black', colorHex: '#161616', material: 'Leather', fit: 'Medium' },
    ],
  },
  {
    id: 'fall-bonfire-night', presentation: 'womenswear', name: 'Bonfire Night', era: FALL, mood: 'Backyard bonfire', person: 'mei',
    scene: 'a backyard bonfire at dusk with friends around it',
    description: 'A fisherman sweater, shearling boots and a rust beanie by the fire.',
    items: [
      { slot: 'top', name: 'Fisherman sweater', color: 'Ivory', colorHex: '#EFE8DA', material: 'Wool', fit: 'Chunky, oversized' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Dark wash', colorHex: '#2E3B55', material: 'Denim', fit: 'High-waisted' },
      { slot: 'shoes', name: 'Shearling-lined boots', color: 'Chestnut', colorHex: '#8A5A2E', material: 'Suede', fit: 'Ankle' },
      { slot: 'accessory', name: 'Beanie', color: 'Rust', colorHex: '#9C4A2A', material: 'Wool', fit: 'Ribbed' },
    ],
  },
  {
    id: 'fall-brunch', presentation: 'womenswear', name: 'Fall Brunch', era: FALL, mood: 'Sunday brunch', person: 'nora',
    scene: 'a sunny brunch café with plants',
    description: 'A camel knit vest over a crisp white shirt and cream pleats.',
    items: [
      { slot: 'layer', name: 'Knit vest', color: 'Camel', colorHex: '#B98B5E', material: 'Wool', fit: 'V-neck' },
      { slot: 'top', name: 'Poplin shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton poplin', fit: 'Relaxed' },
      { slot: 'bottom', name: 'Pleated trousers', color: 'Cream', colorHex: '#EFE8DA', material: 'Wool', fit: 'High-waisted, wide' },
      { slot: 'shoes', name: 'Loafers', color: 'Brown', colorHex: '#5A3A22', material: 'Leather', fit: 'Classic' },
    ],
  },
  {
    id: 'fall-road-trip', presentation: 'womenswear', name: 'Road Trip', era: FALL, mood: 'Scenic drive', person: 'ava',
    scene: 'a scenic overlook on a mountain road with fall colors',
    description: 'An olive barn jacket, a grey sweatshirt and white sneakers.',
    items: [
      { slot: 'outerwear', name: 'Barn jacket', color: 'Olive', colorHex: '#5E6B3A', material: 'Waxed cotton with a corduroy collar', fit: 'Relaxed' },
      { slot: 'top', name: 'Crew-neck sweatshirt', color: 'Heather grey', colorHex: '#A6A6A2', material: 'Cotton fleece', fit: 'Relaxed' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Mid wash', colorHex: '#6E86A6', material: 'Denim', fit: 'High-waisted' },
      { slot: 'shoes', name: 'Sneakers', color: 'White', colorHex: '#F2F2EF', material: 'Leather', fit: 'Low top' },
    ],
  },
  {
    id: 'fall-country-concert', presentation: 'womenswear', name: 'Country Concert', era: FALL, mood: 'Outdoor concert', person: 'sofia',
    scene: 'an outdoor country music festival at sunset, no logos',
    description: 'A suede fringe jacket, a black slip dress and cowboy boots.',
    items: [
      { slot: 'outerwear', name: 'Fringe jacket', color: 'Tan', colorHex: '#B08A5E', material: 'Suede', fit: 'Cropped' },
      { slot: 'dress', name: 'Slip dress', color: 'Black', colorHex: '#151515', material: 'Satin', fit: 'Mini' },
      { slot: 'shoes', name: 'Cowboy boots', color: 'Brown', colorHex: '#5A3A22', material: 'Leather', fit: 'Mid-calf' },
    ],
  },
  // Menswear.
  {
    id: 'fm-pumpkin-patch', presentation: 'menswear', name: 'Pumpkin Patch', era: FALL, mood: 'Pumpkin patch', person: 'marcus',
    scene: 'a pumpkin patch on a sunny fall afternoon, hay bales and pumpkins around',
    description: 'A buffalo-check shirt over a cream henley, dark jeans and work boots.',
    items: [
      { slot: 'layer', name: 'Buffalo-check shirt', color: 'Red and black', colorHex: '#A3242B', material: 'Flannel', fit: 'Worn open' },
      { slot: 'top', name: 'Henley', color: 'Cream', colorHex: '#EDE4D3', material: 'Cotton waffle knit', fit: 'Regular' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Dark wash', colorHex: '#2E3B55', material: 'Denim', fit: 'Straight' },
      { slot: 'shoes', name: 'Work boots', color: 'Brown', colorHex: '#6B4A2F', material: 'Leather', fit: 'Lace-up' },
    ],
  },
  {
    id: 'fm-game-day', presentation: 'menswear', name: 'Game Day', era: FALL, mood: 'Football Saturday', person: 'kenji',
    scene: 'a college football tailgate in a parking lot on a sunny fall day, no logos anywhere',
    description: 'A navy quarter-zip, khaki chinos and white sneakers.',
    items: [
      { slot: 'top', name: 'Quarter-zip pullover', color: 'Navy', colorHex: '#1F2A44', material: 'Merino', fit: 'Regular' },
      { slot: 'bottom', name: 'Chinos', color: 'Khaki', colorHex: '#C3B08A', material: 'Cotton twill', fit: 'Slim' },
      { slot: 'shoes', name: 'Sneakers', color: 'White', colorHex: '#F2F2EF', material: 'Leather', fit: 'Low top' },
    ],
  },
  {
    id: 'fm-leaf-peeping', presentation: 'menswear', name: 'Leaf Peeping', era: FALL, mood: 'New England weekend', person: 'diego',
    scene: 'a New England village street with bright red and orange fall foliage',
    description: 'An olive barn jacket, a cream crewneck and suede chukkas.',
    items: [
      { slot: 'outerwear', name: 'Barn jacket', color: 'Olive', colorHex: '#5E6B3A', material: 'Waxed cotton with a corduroy collar', fit: 'Regular' },
      { slot: 'top', name: 'Crew-neck sweater', color: 'Cream', colorHex: '#EDE4D3', material: 'Lambswool', fit: 'Regular' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Dark wash', colorHex: '#2E3B55', material: 'Denim', fit: 'Straight' },
      { slot: 'shoes', name: 'Chukka boots', color: 'Brown', colorHex: '#6B4A2F', material: 'Suede', fit: 'Classic' },
    ],
  },
  {
    id: 'fm-date-night', presentation: 'menswear', name: 'Fall Date Night', era: FALL, mood: 'Wine bar date', person: 'arjun',
    scene: 'a cozy wine bar at night',
    description: 'A charcoal turtleneck, camel trousers and Chelsea boots.',
    items: [
      { slot: 'top', name: 'Turtleneck', color: 'Charcoal', colorHex: '#3C3C3E', material: 'Merino', fit: 'Fitted' },
      { slot: 'bottom', name: 'Wool trousers', color: 'Camel', colorHex: '#B98B5E', material: 'Wool', fit: 'Straight' },
      { slot: 'outerwear', name: 'Overcoat', color: 'Charcoal', colorHex: '#3C3C3E', material: 'Wool', fit: 'Knee length' },
      { slot: 'shoes', name: 'Chelsea boots', color: 'Dark brown', colorHex: '#3E2A22', material: 'Suede', fit: 'Classic' },
    ],
  },
  {
    id: 'fm-office', presentation: 'menswear', name: 'Fall at the Office', era: FALL, mood: 'Office', person: 'liam',
    scene: 'a bright office lobby in the morning',
    description: 'A navy blazer, a light blue oxford and stone chinos.',
    items: [
      { slot: 'outerwear', name: 'Blazer', color: 'Navy', colorHex: '#1F2A44', material: 'Wool', fit: 'Slim, single-breasted' },
      { slot: 'top', name: 'Oxford shirt', color: 'Light blue', colorHex: '#BFD2E6', material: 'Cotton oxford', fit: 'Slim' },
      { slot: 'bottom', name: 'Chinos', color: 'Stone', colorHex: '#CFC4AE', material: 'Cotton twill', fit: 'Slim' },
      { slot: 'shoes', name: 'Loafers', color: 'Brown', colorHex: '#5A3A22', material: 'Leather', fit: 'Classic' },
    ],
  },
  {
    id: 'fm-bonfire-night', presentation: 'menswear', name: 'Bonfire Night', era: FALL, mood: 'Backyard bonfire', person: 'erik',
    scene: 'a backyard bonfire at dusk with friends around it',
    description: 'A fisherman sweater, jeans, boots and an olive beanie.',
    items: [
      { slot: 'top', name: 'Fisherman sweater', color: 'Ivory', colorHex: '#EFE8DA', material: 'Wool', fit: 'Chunky' },
      { slot: 'bottom', name: 'Straight jeans', color: 'Dark wash', colorHex: '#2E3B55', material: 'Denim', fit: 'Straight' },
      { slot: 'shoes', name: 'Lace-up boots', color: 'Brown', colorHex: '#6B4A2F', material: 'Leather', fit: 'Classic' },
      { slot: 'accessory', name: 'Beanie', color: 'Olive', colorHex: '#5B6342', material: 'Wool', fit: 'Ribbed' },
    ],
  },
]

// The Fall Wedding Guest Edit (Oct 13): every dress code and venue of an
// American fall wedding. Never white or ivory on a guest.
// The fall-weddings reel (Oct 16, design/social/2026-10-fall-weddings):
// Greta's one emerald slip dress, styled for six venues with a few pieces
// each. They lead the Edit, as the reel sends people here to try them on.
const FALL_WEDDINGS_REEL = 'social/2026-10-fall-weddings/gen'
const EMERALD_SLIP: EditLook['items'][number] = {
  slot: 'dress', name: 'Satin slip dress', color: 'Emerald', colorHex: '#0F5A3C', material: 'Satin', fit: 'Midi, cowl neck, thin straps, bias cut',
}

const weddings: EditLook[] = [
  {
    id: 'wed-emerald-barn', presentation: 'womenswear', name: 'Emerald Slip · Barn', era: WEDDINGS, mood: 'Barn wedding', person: 'greta', source: `${FALL_WEDDINGS_REEL}/barn.png`,
    scene: 'a barn wedding reception under warm string lights at dusk',
    description: 'One emerald slip dress, a cropped suede jacket and western boots: dressed up, ready for hay bales.',
    items: [
      EMERALD_SLIP,
      { slot: 'outerwear', name: 'Cropped suede jacket', color: 'Tan', colorHex: '#9A6A3E', material: 'Suede', fit: 'Cropped, worn open' },
      { slot: 'shoes', name: 'Western ankle boots', color: 'Cognac', colorHex: '#8A4F2A', material: 'Leather', fit: 'Pointed toe, stacked heel' },
      { slot: 'accessory', name: 'Turquoise drop earrings', color: 'Turquoise', colorHex: '#3FB6B2', material: 'Stone and silver', fit: 'Small' },
    ],
  },
  {
    id: 'wed-emerald-vineyard', presentation: 'womenswear', name: 'Emerald Slip · Vineyard', era: WEDDINGS, mood: 'Vineyard wedding', person: 'greta', source: `${FALL_WEDDINGS_REEL}/vineyard.png`,
    scene: 'a vineyard wedding at golden hour between the vines',
    description: 'The emerald slip with a camel pashmina for the sunset and block heels for the grass.',
    items: [
      EMERALD_SLIP,
      { slot: 'outerwear', name: 'Cashmere pashmina', color: 'Camel', colorHex: '#C19A6B', material: 'Cashmere', fit: 'Draped over the shoulders' },
      { slot: 'shoes', name: 'Block-heel sandals', color: 'Tan', colorHex: '#B08458', material: 'Suede', fit: 'Ankle strap, mid heel' },
      { slot: 'bag', name: 'Woven clutch', color: 'Natural straw', colorHex: '#CDB27E', material: 'Straw', fit: 'Small' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Medium' },
    ],
  },
  {
    id: 'wed-emerald-city-hall', presentation: 'womenswear', name: 'Emerald Slip · City Hall', era: WEDDINGS, mood: 'City hall wedding', person: 'greta', source: `${FALL_WEDDINGS_REEL}/cityhall.png`,
    scene: 'the steps of a city hall on a bright fall morning',
    description: 'A black blazer over the shoulders, pumps and pearls: the emerald slip goes polished for a daytime ceremony.',
    items: [
      EMERALD_SLIP,
      { slot: 'outerwear', name: 'Tailored blazer', color: 'Black', colorHex: '#151515', material: 'Wool crepe', fit: 'Worn over the shoulders' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Black', colorHex: '#121212', material: 'Leather', fit: 'High heel' },
      { slot: 'bag', name: 'Top-handle bag', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Small' },
      { slot: 'accessory', name: 'Pearl drop earrings', color: 'Pearl', colorHex: '#E9E1D3', material: 'Pearl and gold', fit: 'Small' },
    ],
  },
  {
    id: 'wed-emerald-mountain', presentation: 'womenswear', name: 'Emerald Slip · Mountain', era: WEDDINGS, mood: 'Mountain wedding', person: 'greta', source: `${FALL_WEDDINGS_REEL}/mountain.png`,
    scene: 'a mountain lodge wedding by a stone fireplace at dusk',
    description: 'A cream faux-fur stole and knee-high suede boots keep the emerald slip warm for a lodge in the mountains.',
    items: [
      EMERALD_SLIP,
      { slot: 'outerwear', name: 'Faux-fur stole', color: 'Cream', colorHex: '#EDE3D1', material: 'Faux fur', fit: 'Around the shoulders' },
      { slot: 'shoes', name: 'Knee-high boots', color: 'Brown', colorHex: '#5A3A24', material: 'Suede', fit: 'Block heel' },
      { slot: 'accessory', name: 'Cuff bracelet', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Chunky' },
    ],
  },
  {
    id: 'wed-emerald-cocktail', presentation: 'womenswear', name: 'Emerald Slip · Cocktail', era: WEDDINGS, mood: 'Cocktail attire', person: 'greta', source: `${FALL_WEDDINGS_REEL}/cocktail.png`,
    scene: 'an evening cocktail-hour wedding reception lit by candles',
    description: 'A cropped gold sequin jacket and gold heels turn the emerald slip into evening cocktail attire.',
    items: [
      EMERALD_SLIP,
      { slot: 'outerwear', name: 'Sequin jacket', color: 'Gold', colorHex: '#C8A24A', material: 'Sequins', fit: 'Cropped, worn open' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Gold', colorHex: '#C9A24A', material: 'Metallic leather', fit: 'High heel' },
      { slot: 'accessory', name: 'Statement earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Bold' },
    ],
  },
  {
    id: 'wed-emerald-black-tie', presentation: 'womenswear', name: 'Emerald Slip · Black Tie Optional', era: WEDDINGS, mood: 'Black tie optional', person: 'greta', source: `${FALL_WEDDINGS_REEL}/blacktie.png`,
    scene: 'a ballroom wedding reception under crystal chandeliers',
    description: 'Black satin opera gloves, crystal earrings and a low chignon: the emerald slip at its most formal.',
    items: [
      EMERALD_SLIP,
      { slot: 'accessory', name: 'Opera gloves', color: 'Black', colorHex: '#111111', material: 'Satin', fit: 'Above the elbow' },
      { slot: 'accessory', name: 'Crystal drop earrings', color: 'Crystal', colorHex: '#E6ECF2', material: 'Crystal', fit: 'Long' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Black', colorHex: '#121212', material: 'Satin', fit: 'High heel' },
      { slot: 'bag', name: 'Crystal clutch', color: 'Silver', colorHex: '#C9CED3', material: 'Crystals', fit: 'Small' },
    ],
  },
  {
    id: 'wed-velvet-column', presentation: 'womenswear', name: 'Velvet Column Gown', era: WEDDINGS, mood: 'Black tie', person: 'imani',
    scene: 'a grand hotel ballroom wedding reception with crystal chandeliers and candlelit round tables',
    description: 'Emerald velvet to the floor and gold everything: black tie, done right.',
    items: [
      { slot: 'dress', name: 'Velvet column gown', color: 'Emerald', colorHex: '#0B5D45', material: 'Velvet', fit: 'Floor length, square neck, long sleeves, straight column' },
      { slot: 'accessory', name: 'Drop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Statement' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Gold', colorHex: '#C9A24A', material: 'Metallic leather', fit: 'High heel' },
      { slot: 'bag', name: 'Box clutch', color: 'Gold', colorHex: '#C8A24A', material: 'Metal', fit: 'Small' },
    ],
  },
  {
    id: 'wed-burgundy-bias', presentation: 'womenswear', name: 'Burgundy Bias Gown', era: WEDDINGS, mood: 'Black tie optional', person: 'ava',
    scene: 'an evening wedding reception in a historic mansion lit by candles, guests in formal wear behind',
    description: 'Bias-cut burgundy satin with a faux-fur stole for the walk outside.',
    items: [
      { slot: 'dress', name: 'Bias-cut satin gown', color: 'Burgundy', colorHex: '#6E1F2E', material: 'Satin', fit: 'Floor length, cowl neck, thin straps' },
      { slot: 'outerwear', name: 'Faux-fur stole', color: 'Chocolate', colorHex: '#4A3328', material: 'Faux fur', fit: 'Draped over the shoulders' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Burgundy', colorHex: '#6E1F2E', material: 'Satin', fit: 'High heel' },
      { slot: 'accessory', name: 'Pearl drop earrings', color: 'Pearl', colorHex: '#E9E1D3', material: 'Pearl and gold', fit: 'Small' },
    ],
  },
  {
    id: 'wed-navy-one-shoulder', presentation: 'womenswear', name: 'One-Shoulder Cocktail', era: WEDDINGS, mood: 'Cocktail attire', person: 'sofia',
    scene: 'a city rooftop wedding reception at dusk with string lights and the skyline behind',
    description: 'A navy one-shoulder midi with gold sandals: polished, easy to dance in.',
    items: [
      { slot: 'dress', name: 'One-shoulder dress', color: 'Navy', colorHex: '#1F2A44', material: 'Crepe', fit: 'Midi, fitted waist, softly flared skirt' },
      { slot: 'shoes', name: 'Block-heel sandals', color: 'Gold', colorHex: '#C9A24A', material: 'Metallic leather', fit: 'Mid heel' },
      { slot: 'bag', name: 'Clutch', color: 'Gold', colorHex: '#C8A24A', material: 'Metallic leather', fit: 'Small' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Medium' },
    ],
  },
  {
    id: 'wed-plum-chiffon', presentation: 'womenswear', name: 'Vineyard Chiffon', era: WEDDINGS, mood: 'Vineyard wedding', person: 'mei',
    scene: 'a vineyard wedding at golden hour, vine rows and a long candlelit dinner table behind',
    description: 'Plum chiffon with flutter sleeves, light enough for the walk between the vines.',
    items: [
      { slot: 'dress', name: 'Chiffon midi dress', color: 'Plum', colorHex: '#5E3A5A', material: 'Silk chiffon', fit: 'V-neck, flutter sleeves, tiered midi skirt' },
      { slot: 'shoes', name: 'Block-heel sandals', color: 'Nude', colorHex: '#C9A58A', material: 'Leather', fit: 'Low heel' },
      { slot: 'bag', name: 'Suede clutch', color: 'Taupe', colorHex: '#8C7A6B', material: 'Suede', fit: 'Small' },
      { slot: 'accessory', name: 'Cuff bracelet', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Slim' },
    ],
  },
  {
    id: 'wed-sage-pleats', presentation: 'womenswear', name: 'Sage Garden Pleats', era: WEDDINGS, mood: 'Garden wedding', person: 'helen',
    scene: 'an afternoon garden wedding on a lawn with autumn trees and rows of wooden chairs',
    description: 'Long-sleeved sage pleats and taupe slingbacks: elegant, and warm enough outdoors.',
    items: [
      { slot: 'dress', name: 'Pleated midi dress', color: 'Sage', colorHex: '#8A9A7B', material: 'Crepe', fit: 'High neck, long sleeves, belted waist, pleated midi skirt' },
      { slot: 'shoes', name: 'Slingback pumps', color: 'Taupe', colorHex: '#8C7A6B', material: 'Leather', fit: 'Low heel' },
      { slot: 'bag', name: 'Structured clutch', color: 'Taupe', colorHex: '#8C7A6B', material: 'Leather', fit: 'Small' },
      { slot: 'accessory', name: 'Pearl studs', color: 'Pearl', colorHex: '#E9E1D3', material: 'Pearl', fit: 'Small' },
    ],
  },
  {
    id: 'wed-mountain-slip', presentation: 'womenswear', name: 'Mountain Wedding Layers', era: WEDDINGS, mood: 'Mountain wedding', person: 'nora',
    scene: 'an outdoor mountain wedding at sunset with pine trees and a wooden lodge behind',
    description: 'Forest-green satin, a camel coat on the shoulders and suede boots for the cold.',
    items: [
      { slot: 'dress', name: 'Satin slip dress', color: 'Forest green', colorHex: '#1F3B2D', material: 'Satin', fit: 'Midi, bias cut' },
      { slot: 'outerwear', name: 'Wrap coat', color: 'Camel', colorHex: '#C19A6B', material: 'Wool', fit: 'Long, draped over the shoulders' },
      { slot: 'shoes', name: 'Heeled boots', color: 'Cognac', colorHex: '#8B5A2B', material: 'Suede', fit: 'Knee high, block heel' },
      { slot: 'accessory', name: 'Pendant necklace', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Fine chain' },
    ],
  },
  {
    id: 'wed-city-hall-suit', presentation: 'womenswear', name: 'City Hall Suit', era: WEDDINGS, mood: 'City hall wedding', person: 'ava',
    scene: 'the stone steps of a grand city hall building on a crisp fall day, a small wedding party nearby',
    description: 'A chocolate suit over blush silk: the sharpest guest at a courthouse wedding.',
    items: [
      { slot: 'suit', name: 'Tailored suit', color: 'Chocolate brown', colorHex: '#4A3328', material: 'Wool crepe', fit: 'Single-breasted blazer, high-waisted wide-leg trousers' },
      { slot: 'top', name: 'Silk camisole', color: 'Blush', colorHex: '#D9A9A0', material: 'Silk', fit: 'Cowl neck' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Nude', colorHex: '#C9A58A', material: 'Leather', fit: 'Mid heel' },
      { slot: 'bag', name: 'Top-handle bag', color: 'Blush', colorHex: '#D9A9A0', material: 'Leather', fit: 'Mini' },
    ],
  },
  {
    id: 'wed-black-jumpsuit', presentation: 'womenswear', name: 'Evening Jumpsuit', era: WEDDINGS, mood: 'Evening wedding', person: 'mei',
    scene: 'a modern art-gallery wedding reception at night with white walls, candles and guests',
    description: 'A halter jumpsuit with big gold earrings: evening-ready, no gown needed.',
    items: [
      { slot: 'dress', name: 'Halter jumpsuit', color: 'Black', colorHex: '#151515', material: 'Crepe', fit: 'Halter neck, belted waist, wide legs to the floor' },
      { slot: 'accessory', name: 'Statement earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Sculptural' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Gold', colorHex: '#C9A24A', material: 'Metallic leather', fit: 'High heel' },
      { slot: 'bag', name: 'Clutch', color: 'Gold', colorHex: '#C8A24A', material: 'Metallic leather', fit: 'Small' },
    ],
  },
  {
    id: 'wed-teal-velvet-wrap', presentation: 'womenswear', name: 'Teal Velvet Wrap', era: WEDDINGS, mood: 'Semi-formal', person: 'sofia',
    scene: 'a candlelit restaurant wedding dinner with long tables and autumn flowers',
    description: 'A deep teal velvet wrap that flatters every curve, with gold at the ears.',
    items: [
      { slot: 'dress', name: 'Velvet wrap dress', color: 'Deep teal', colorHex: '#1F5560', material: 'Velvet', fit: 'Midi, long sleeves, wrap waist, V-neck' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Gold', colorHex: '#C9A24A', material: 'Metallic leather', fit: 'Mid heel' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Medium' },
    ],
  },
  {
    id: 'wed-copper-sequins', presentation: 'womenswear', name: 'Copper Sequins', era: WEDDINGS, mood: 'Black tie optional', person: 'imani',
    scene: 'a lavish evening wedding reception with a dance floor, warm lights and guests dancing behind',
    description: 'A copper sequin slip that catches every light on the dance floor.',
    items: [
      { slot: 'dress', name: 'Sequin slip dress', color: 'Copper', colorHex: '#B5652F', material: 'Sequins', fit: 'Midi, cowl neck, thin straps' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Bronze', colorHex: '#8C5A33', material: 'Metallic leather', fit: 'High heel' },
      { slot: 'bag', name: 'Satin clutch', color: 'Black', colorHex: '#151515', material: 'Satin', fit: 'Small' },
    ],
  },
  {
    id: 'wed-mauve-flutter', presentation: 'womenswear', name: 'Lakeside Mauve', era: WEDDINGS, mood: 'Lakeside wedding', person: 'sofia',
    scene: 'a lakeside wedding ceremony with colorful fall trees reflected in the water',
    description: 'A mauve wrap with flutter sleeves: soft, romantic and made for photos.',
    items: [
      { slot: 'dress', name: 'Flutter-sleeve wrap dress', color: 'Mauve', colorHex: '#9A6A7A', material: 'Crepe', fit: 'Midi, V-neck, flutter sleeves, wrap waist' },
      { slot: 'shoes', name: 'Block-heel sandals', color: 'Nude', colorHex: '#C9A58A', material: 'Leather', fit: 'Low heel' },
      { slot: 'bag', name: 'Clutch', color: 'Nude', colorHex: '#C9A58A', material: 'Leather', fit: 'Small' },
      { slot: 'accessory', name: 'Drop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Small' },
    ],
  },
  {
    id: 'wed-marigold-cowl', presentation: 'womenswear', name: 'Marigold Cowl', era: WEDDINGS, mood: 'Cocktail attire', person: 'imani',
    scene: 'a garden-party wedding reception at golden hour with string lights and autumn trees',
    description: 'Marigold satin with chocolate suede: the warmest color in the room.',
    items: [
      { slot: 'dress', name: 'Satin cowl-neck dress', color: 'Marigold', colorHex: '#D9A13B', material: 'Satin', fit: 'Midi, bias cut, thin straps' },
      { slot: 'shoes', name: 'Strappy heels', color: 'Chocolate', colorHex: '#4A3328', material: 'Suede', fit: 'Mid heel' },
      { slot: 'bag', name: 'Suede clutch', color: 'Chocolate', colorHex: '#4A3328', material: 'Suede', fit: 'Small' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Medium' },
    ],
  },
  {
    id: 'wed-terracotta-set', presentation: 'womenswear', name: 'Terracotta Two-Piece', era: WEDDINGS, mood: 'Rustic wedding', person: 'nora',
    scene: 'a rustic farm wedding with hay bales, string lights and autumn trees at sunset',
    description: 'A matching terracotta satin set: a halter top and a bias midi skirt.',
    items: [
      { slot: 'top', name: 'Satin halter top', color: 'Terracotta', colorHex: '#B5603A', material: 'Satin', fit: 'Cropped just above the waist' },
      { slot: 'bottom', name: 'Satin midi skirt', color: 'Terracotta', colorHex: '#B5603A', material: 'Satin', fit: 'High waist, bias cut, midi' },
      { slot: 'shoes', name: 'Block-heel sandals', color: 'Cognac', colorHex: '#8B5A2B', material: 'Leather', fit: 'Mid heel' },
      { slot: 'bag', name: 'Suede clutch', color: 'Cognac', colorHex: '#8B5A2B', material: 'Suede', fit: 'Small' },
    ],
  },
  {
    id: 'wed-dusty-rose-lace', presentation: 'womenswear', name: 'Dusty Rose Lace', era: WEDDINGS, mood: 'Church wedding', person: 'helen',
    scene: 'outside an old stone church after a fall wedding ceremony, autumn leaves on the path',
    description: 'Long-sleeved dusty rose lace: graceful for a church ceremony and the dinner after.',
    items: [
      { slot: 'dress', name: 'Lace midi dress', color: 'Dusty rose', colorHex: '#C08A86', material: 'Lace over a satin lining', fit: 'Fitted bodice, long sleeves, midi' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Nude', colorHex: '#C9A58A', material: 'Leather', fit: 'Low heel' },
      { slot: 'bag', name: 'Clutch', color: 'Taupe', colorHex: '#8C7A6B', material: 'Leather', fit: 'Small' },
      { slot: 'accessory', name: 'Pearl earrings', color: 'Pearl', colorHex: '#E9E1D3', material: 'Pearl', fit: 'Small' },
    ],
  },
  {
    id: 'wed-slate-cape', presentation: 'womenswear', name: 'Slate Cape Gown', era: WEDDINGS, mood: 'Formal', person: 'helen',
    scene: 'a country-club wedding reception with tall windows, fall flowers and soft evening light',
    description: 'A slate-blue cape gown: covered arms, a floor-length line and real presence.',
    items: [
      { slot: 'dress', name: 'Cape-sleeve gown', color: 'Slate blue', colorHex: '#5A6E8C', material: 'Crepe', fit: 'Floor length, cape sleeves, fitted waist' },
      { slot: 'accessory', name: 'Crystal drop earrings', color: 'Silver', colorHex: '#C0C0C0', material: 'Crystal and metal', fit: 'Drop' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Silver', colorHex: '#BFC1C2', material: 'Metallic leather', fit: 'Low heel' },
      { slot: 'bag', name: 'Clutch', color: 'Silver', colorHex: '#BFC1C2', material: 'Metallic leather', fit: 'Small' },
    ],
  },
  {
    id: 'wed-sapphire-halter', presentation: 'womenswear', name: 'Sapphire Halter', era: WEDDINGS, mood: 'Black tie', person: 'nora',
    scene: 'a museum-hall wedding reception at night with stone columns, candles and guests in black tie',
    description: 'Sapphire satin with an open back: the gown people turn around for.',
    items: [
      { slot: 'dress', name: 'Satin halter gown', color: 'Sapphire', colorHex: '#1F4E9C', material: 'Satin', fit: 'Floor length, halter neck, open back' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Silver', colorHex: '#BFC1C2', material: 'Metallic leather', fit: 'High heel' },
      { slot: 'accessory', name: 'Crystal studs', color: 'Silver', colorHex: '#C0C0C0', material: 'Crystal', fit: 'Small' },
      { slot: 'bag', name: 'Clutch', color: 'Silver', colorHex: '#BFC1C2', material: 'Metallic leather', fit: 'Small' },
    ],
  },
  {
    id: 'wed-gold-pleats', presentation: 'womenswear', name: 'Gold Pleats', era: WEDDINGS, mood: 'Evening wedding', person: 'mei',
    scene: 'a city loft wedding reception with exposed brick, candles and string lights',
    description: 'A gold pleated skirt under a fine black turtleneck: chic, warm and unexpected.',
    items: [
      { slot: 'top', name: 'Fine-knit turtleneck', color: 'Black', colorHex: '#151515', material: 'Merino', fit: 'Fitted, tucked in' },
      { slot: 'bottom', name: 'Pleated midi skirt', color: 'Gold', colorHex: '#C9A44C', material: 'Metallic lamé', fit: 'High waist, sunray pleats, midi' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Black', colorHex: '#151515', material: 'Suede', fit: 'High heel' },
      { slot: 'bag', name: 'Clutch', color: 'Black', colorHex: '#151515', material: 'Satin', fit: 'Small' },
    ],
  },
  {
    id: 'wed-velvet-tux', presentation: 'womenswear', name: 'Velvet Tuxedo', era: WEDDINGS, mood: 'Black tie optional', person: 'ava',
    scene: 'a jazz-club wedding after-party with warm lights, a small stage and guests',
    description: 'A black velvet tuxedo with satin lapels and a lace camisole: no gown, all glamour.',
    items: [
      { slot: 'suit', name: 'Velvet tuxedo', color: 'Black', colorHex: '#121212', material: 'Velvet with satin lapels', fit: 'Fitted blazer, slim straight trousers' },
      { slot: 'top', name: 'Lace camisole', color: 'Black', colorHex: '#151515', material: 'Lace', fit: 'Fitted' },
      { slot: 'shoes', name: 'Pointed pumps', color: 'Gold', colorHex: '#C9A24A', material: 'Metallic leather', fit: 'High heel' },
      { slot: 'accessory', name: 'Drop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Long' },
    ],
  },
  {
    id: 'wed-barn-chic', presentation: 'womenswear', name: 'Barn Chic', era: WEDDINGS, mood: 'Barn wedding', person: 'imani',
    scene: 'a red barn wedding at sunset with hay bales, string lights and guests behind',
    description: 'Burnt-orange tiers, a tan suede jacket and western boots: country, dressed up.',
    items: [
      { slot: 'dress', name: 'Tiered midi dress', color: 'Burnt orange', colorHex: '#B65A2B', material: 'Crinkle chiffon', fit: 'Puff sleeves, tiered midi skirt' },
      { slot: 'outerwear', name: 'Cropped suede jacket', color: 'Tan', colorHex: '#B08860', material: 'Suede', fit: 'Cropped, worn open' },
      { slot: 'shoes', name: 'Western boots', color: 'Cognac', colorHex: '#8B5A2B', material: 'Leather', fit: 'Mid calf, low heel' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Medium' },
    ],
  },
  {
    id: 'wed-chocolate-satin', presentation: 'womenswear', name: 'Chocolate Satin Gown', era: WEDDINGS, mood: 'Winery wedding', person: 'sofia',
    scene: 'a winery wedding reception at night with candlelit oak barrels and long tables',
    description: 'Draped chocolate satin and gold: this fall’s color, at its most formal.',
    items: [
      { slot: 'dress', name: 'Draped satin gown', color: 'Chocolate', colorHex: '#4A2E25', material: 'Satin', fit: 'Floor length, one shoulder, draped waist' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Gold', colorHex: '#C9A24A', material: 'Metallic leather', fit: 'High heel' },
      { slot: 'accessory', name: 'Cuff bracelet', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Wide' },
      { slot: 'bag', name: 'Clutch', color: 'Gold', colorHex: '#C8A24A', material: 'Metallic leather', fit: 'Small' },
    ],
  },
  // Menswear.
  {
    id: 'wedm-black-tie', presentation: 'menswear', name: 'Classic Tuxedo', era: WEDDINGS, mood: 'Black tie', person: 'marcus',
    scene: 'a grand hotel ballroom wedding reception with crystal chandeliers and candlelit round tables',
    description: 'A black peak-lapel tuxedo, a pleated shirt and a silk bow tie.',
    items: [
      { slot: 'suit', name: 'Tuxedo', color: 'Black', colorHex: '#121212', material: 'Wool with satin lapels', fit: 'Slim, peak lapels' },
      { slot: 'top', name: 'Tuxedo shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton', fit: 'Pleated bib, turndown collar' },
      { slot: 'accessory', name: 'Bow tie', color: 'Black', colorHex: '#151515', material: 'Silk', fit: 'Self-tied' },
      { slot: 'shoes', name: 'Oxfords', color: 'Black', colorHex: '#151515', material: 'Patent leather', fit: 'Classic' },
    ],
  },
  {
    id: 'wedm-velvet-jacket', presentation: 'menswear', name: 'Velvet Dinner Jacket', era: WEDDINGS, mood: 'Black tie optional', person: 'diego',
    scene: 'an evening wedding reception in a historic mansion lit by candles, guests in formal wear behind',
    description: 'A midnight velvet dinner jacket with black trousers and velvet loafers.',
    items: [
      { slot: 'outerwear', name: 'Velvet dinner jacket', color: 'Midnight navy', colorHex: '#1A2340', material: 'Velvet', fit: 'Shawl lapel, single button' },
      { slot: 'bottom', name: 'Tuxedo trousers', color: 'Black', colorHex: '#121212', material: 'Wool', fit: 'Slim, satin side stripe' },
      { slot: 'top', name: 'Dress shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton', fit: 'Slim' },
      { slot: 'accessory', name: 'Bow tie', color: 'Black', colorHex: '#151515', material: 'Silk', fit: 'Self-tied' },
      { slot: 'shoes', name: 'Velvet loafers', color: 'Black', colorHex: '#151515', material: 'Velvet', fit: 'Slip-on' },
    ],
  },
  {
    id: 'wedm-charcoal-cocktail', presentation: 'menswear', name: 'Charcoal and Burgundy', era: WEDDINGS, mood: 'Cocktail attire', person: 'kenji',
    scene: 'a city rooftop wedding reception at dusk with string lights and the skyline behind',
    description: 'A charcoal suit, a pale blue shirt and a burgundy silk tie.',
    items: [
      { slot: 'suit', name: 'Two-piece suit', color: 'Charcoal', colorHex: '#3A3D42', material: 'Wool', fit: 'Slim, notch lapels' },
      { slot: 'top', name: 'Dress shirt', color: 'Pale blue', colorHex: '#BFD3E6', material: 'Cotton', fit: 'Spread collar' },
      { slot: 'accessory', name: 'Silk tie', color: 'Burgundy', colorHex: '#6E1F2E', material: 'Silk', fit: 'Solid' },
      { slot: 'shoes', name: 'Oxfords', color: 'Black', colorHex: '#151515', material: 'Leather', fit: 'Cap toe' },
    ],
  },
  {
    id: 'wedm-tweed-barn', presentation: 'menswear', name: 'Tweed Barn Wedding', era: WEDDINGS, mood: 'Barn wedding', person: 'liam',
    scene: 'a red barn wedding at sunset with hay bales, string lights and guests behind',
    description: 'A brown tweed three-piece with a forest-green knit tie and brogues.',
    items: [
      { slot: 'suit', name: 'Tweed three-piece suit', color: 'Brown', colorHex: '#6B4E36', material: 'Wool tweed', fit: 'Jacket, vest and trousers, regular fit' },
      { slot: 'top', name: 'Oxford shirt', color: 'Pale blue', colorHex: '#BFD3E6', material: 'Cotton', fit: 'Button-down collar' },
      { slot: 'accessory', name: 'Knit tie', color: 'Forest green', colorHex: '#1F3B2D', material: 'Wool', fit: 'Square end' },
      { slot: 'shoes', name: 'Brogues', color: 'Brown', colorHex: '#6B4A2E', material: 'Leather', fit: 'Classic' },
    ],
  },
  {
    id: 'wedm-vineyard-navy', presentation: 'menswear', name: 'Vineyard Navy', era: WEDDINGS, mood: 'Vineyard wedding', person: 'arjun',
    scene: 'a vineyard wedding at golden hour, vine rows and a long candlelit dinner table behind',
    description: 'An unstructured navy suit, an open collar and suede loafers: relaxed, never sloppy.',
    items: [
      { slot: 'suit', name: 'Unstructured suit', color: 'Navy', colorHex: '#1F2A44', material: 'Wool and linen', fit: 'Soft shoulders, slim trousers' },
      { slot: 'top', name: 'Dress shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton', fit: 'Open collar, no tie' },
      { slot: 'accessory', name: 'Pocket square', color: 'Rust', colorHex: '#A4472A', material: 'Silk', fit: 'Folded' },
      { slot: 'shoes', name: 'Suede loafers', color: 'Brown', colorHex: '#6B4A2E', material: 'Suede', fit: 'Penny loafer' },
    ],
  },
  {
    id: 'wedm-olive-mountain', presentation: 'menswear', name: 'Mountain Wedding Suit', era: WEDDINGS, mood: 'Mountain wedding', person: 'erik',
    scene: 'an outdoor mountain wedding at sunset with pine trees and a wooden lodge behind',
    description: 'An olive suit over an oatmeal turtleneck, with suede Chelsea boots.',
    items: [
      { slot: 'suit', name: 'Wool suit', color: 'Olive', colorHex: '#5B5B3A', material: 'Wool flannel', fit: 'Slim' },
      { slot: 'top', name: 'Fine-knit turtleneck', color: 'Oatmeal', colorHex: '#D8CBB5', material: 'Merino', fit: 'Fitted' },
      { slot: 'shoes', name: 'Chelsea boots', color: 'Dark brown', colorHex: '#4A3328', material: 'Suede', fit: 'Slim' },
    ],
  },
]

// The Zodiac Costume Edit (Oct 14): Greta's costume for each sign from the
// zodiac reel (design/social/2026-10-halloween-zodiac), each one the black
// outfit plus a few store-bought pieces and makeup (Silvio: ideas people can
// actually make).
const ZODIAC = 'social/2026-10-halloween-zodiac/gen'
const BLACK_BASE: EditLook['items'] = [
  { slot: 'top', name: 'Turtleneck', color: 'Black', colorHex: '#151515', material: 'Fine knit', fit: 'Fitted' },
  { slot: 'bottom', name: 'Mini skirt', color: 'Black', colorHex: '#161616', material: 'Crepe', fit: 'A-line, above the knee, over sheer black tights' },
  { slot: 'shoes', name: 'Ankle boots', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Block heel' },
]

const zodiac: EditLook[] = [
  {
    id: 'hz-aries-boxer', presentation: 'womenswear', name: 'Aries · Boxer', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/aries.png`,
    scene: 'a living room at a home Halloween party, lit by a warm red party light',
    makeup: 'a small black eye drawn with eyeshadow and a bold red lip, her hair in two tight braids',
    description: 'Red gloves, a toy champion belt and a drawn black eye: the fighter of the zodiac.',
    items: [
      { slot: 'accessory', name: 'Boxing gloves', color: 'Red', colorHex: '#C1121F', material: 'Faux leather', fit: 'One on each hand' },
      { slot: 'accessory', name: 'Toy champion belt', color: 'Gold', colorHex: '#C9A44C', material: 'Plastic', fit: 'Worn over the skirt' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-taurus-rose-queen', presentation: 'womenswear', name: 'Taurus · Rose Queen', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/taurus.png`,
    scene: 'a living room at a home Halloween party, lit by a soft pink and warm gold light',
    makeup: 'rosy glowing makeup',
    description: 'A crown of roses, gold hoops and one red rose: luxe, easy and very Taurus.',
    items: [
      { slot: 'accessory', name: 'Rose crown', color: 'Red and blush', colorHex: '#A4243B', material: 'Faux roses', fit: 'A full crown' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Gold', colorHex: '#C9A44C', material: 'Metal', fit: 'Large' },
      { slot: 'accessory', name: 'Red rose', color: 'Red', colorHex: '#B3141B', material: 'Faux flower', fit: 'Held in one hand' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-gemini-angel-devil', presentation: 'womenswear', name: 'Gemini · Half Angel, Half Devil', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/gemini.png`,
    scene: 'a living room at a home Halloween party, lit white on one side and red on the other',
    makeup: 'her face split down the middle: shimmery white highlighter and a soft pink lip on one half, a red lip and a sharp black winged liner on the other',
    description: 'One headband and half-and-half makeup: both sides of you at once.',
    items: [
      { slot: 'accessory', name: 'Halo and horn headband', color: 'Gold and red', colorHex: '#C9A44C', material: 'Plastic', fit: 'A small halo on one side, one small horn on the other' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-cancer-moon-goddess', presentation: 'womenswear', name: 'Cancer · Moon Goddess', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/cancer.png`,
    scene: 'a living room at a home Halloween party, lit by cool silver-blue moonlight from the window',
    makeup: 'silver glitter freckles across her cheeks and nose and an iridescent highlighter glow',
    description: 'A crescent moon headband, star clips and silver freckles: soft and glowing.',
    items: [
      { slot: 'accessory', name: 'Crescent moon headband', color: 'Silver', colorHex: '#C0C4C9', material: 'Metal', fit: 'A thin band with a small crescent' },
      { slot: 'accessory', name: 'Star hair clips', color: 'Silver', colorHex: '#C0C4C9', material: 'Metal', fit: 'Small' },
      { slot: 'accessory', name: 'Pearl drop earrings', color: 'Pearl white', colorHex: '#F1ECE2', material: 'Pearls', fit: 'Drop' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-leo-lioness', presentation: 'womenswear', name: 'Leo · Lioness', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/leo.png`,
    scene: 'a living room at a home Halloween party, lit by a warm golden amber light',
    makeup: 'a softly drawn lion nose and whisker dots with bronze contour, her hair teased into a big fluffy mane',
    description: 'Lion ears, a teased mane and a faux-fur stole: main-character energy.',
    items: [
      { slot: 'accessory', name: 'Lion ears headband', color: 'Golden brown', colorHex: '#B07A3B', material: 'Faux fur', fit: 'Small round ears' },
      { slot: 'outerwear', name: 'Faux-fur stole', color: 'Golden', colorHex: '#C8963E', material: 'Faux fur', fit: 'Short, over the shoulders' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-virgo-porcelain-doll', presentation: 'womenswear', name: 'Virgo · Porcelain Doll', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/virgo.png`,
    scene: 'a living room at a home Halloween party, under a soft eerie spotlight with dusty pink shadows',
    makeup: 'porcelain doll makeup: pale foundation, round pink cheeks, lashes painted under her eyes, a tiny heart-shaped lip and a few thin cracks drawn with black eyeliner on one cheek',
    description: 'A big bow, a lace collar and drawn cracks: perfectly creepy.',
    items: [
      { slot: 'accessory', name: 'Hair bow', color: 'Black', colorHex: '#111111', material: 'Satin', fit: 'Big' },
      { slot: 'accessory', name: 'Lace collar', color: 'White', colorHex: '#F4F1EA', material: 'Lace', fit: 'Clip-on, over the turtleneck' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-libra-marie-antoinette', presentation: 'womenswear', name: 'Libra · Marie Antoinette', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/libra.png`,
    scene: 'a living room at a home Halloween party, lit by a pale blue-white light with a faint fog',
    makeup: 'pale makeup with pink cheeks and a drawn beauty mark',
    description: 'A costume wig, pearls, a lace fan and a slice of cake. Let them eat cake.',
    items: [
      { slot: 'accessory', name: 'Powdered costume wig', color: 'White', colorHex: '#EDEBE6', material: 'Synthetic hair', fit: 'Short and curled, with a pink ribbon' },
      { slot: 'accessory', name: 'Pearl necklace', color: 'Pearl white', colorHex: '#F1ECE2', material: 'Pearls', fit: 'Long' },
      { slot: 'accessory', name: 'Lace fan', color: 'Ivory', colorHex: '#EFE6D6', material: 'Lace', fit: 'Folding, held open' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-scorpio-raven', presentation: 'womenswear', name: 'Scorpio · Raven', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/scorpio.png`,
    scene: 'a living room at a home Halloween party, lit by a cold deep purple light',
    makeup: 'smoky black eyes and a deep plum lip',
    description: 'A feather headband, a black boa and a fake crow: dark and mysterious.',
    items: [
      { slot: 'accessory', name: 'Feather headband', color: 'Black', colorHex: '#111111', material: 'Feathers', fit: 'Tall' },
      { slot: 'accessory', name: 'Feather boa', color: 'Black', colorHex: '#121212', material: 'Feathers', fit: 'Around the shoulders' },
      { slot: 'accessory', name: 'Fake crow', color: 'Black', colorHex: '#141414', material: 'Craft prop', fit: 'Clipped on one shoulder' },
      { slot: 'accessory', name: 'Lace gloves', color: 'Black', colorHex: '#151515', material: 'Lace', fit: 'Wrist length' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-sagittarius-dark-cupid', presentation: 'womenswear', name: 'Sagittarius · Dark Cupid', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/sagittarius.png`,
    scene: 'a living room at a home Halloween party, lit by a deep red and magenta party light',
    makeup: 'a small red heart drawn on one cheek and red lips',
    description: 'Little black wings, a toy bow and a heart arrow: the archer, with a twist.',
    items: [
      { slot: 'accessory', name: 'Feather wings', color: 'Black', colorHex: '#121212', material: 'Feathers', fit: 'Small, on the back' },
      { slot: 'accessory', name: 'Toy bow and heart arrow', color: 'Red and black', colorHex: '#8B1E2B', material: 'Plastic', fit: 'Held in both hands' },
      { slot: 'accessory', name: 'Flower crown', color: 'Red', colorHex: '#B3141B', material: 'Faux flowers', fit: 'Crown' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-capricorn-corporate-zombie', presentation: 'womenswear', name: 'Capricorn · Corporate Zombie', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/capricorn.png`,
    scene: 'a living room at a home Halloween party, under a flickering cold greenish fluorescent light',
    makeup: 'pale greenish-grey zombie makeup with dark smudged eyes and a few fake stitches drawn on, no blood, messy undone hair',
    description: 'A blazer, an ID badge and a coffee: still working, slightly undead.',
    items: [
      { slot: 'outerwear', name: 'Office blazer', color: 'Grey', colorHex: '#6E6E6E', material: 'Wool blend', fit: 'Slightly torn, worn open' },
      { slot: 'accessory', name: 'ID badge', color: 'White', colorHex: '#F2F2F2', material: 'Plastic', fit: 'On a lanyard' },
      { slot: 'accessory', name: 'Coffee cup', color: 'White', colorHex: '#EFEFEF', material: 'Paper', fit: 'Held in one hand' },
      { slot: 'bag', name: 'Laptop bag', color: 'Black', colorHex: '#1A1A1A', material: 'Nylon', fit: 'On the shoulder' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-aquarius-alien', presentation: 'womenswear', name: 'Aquarius · Alien', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/aquarius.png`,
    scene: 'a living room at a home Halloween party, lit by electric green and cyan light from above',
    makeup: 'silver face gems along her cheekbones, holographic glitter eyeshadow and silver lipstick',
    description: 'Light-up antennae, face gems and a metallic jacket: out of this world.',
    items: [
      { slot: 'accessory', name: 'Light-up antenna headband', color: 'Green', colorHex: '#39D353', material: 'Plastic with LEDs', fit: 'Two small glowing balls' },
      { slot: 'outerwear', name: 'Metallic jacket', color: 'Silver', colorHex: '#C0C4C9', material: 'Metallic faux leather', fit: 'Cropped, worn open' },
      ...BLACK_BASE,
    ],
  },
  {
    id: 'hz-pisces-fairy', presentation: 'womenswear', name: 'Pisces · Fairy', era: ZODIAC_ERA, mood: 'Costume party', person: 'greta', source: `${ZODIAC}/pisces.png`,
    scene: 'a living room at a home Halloween party, lit by soft lilac and teal light with tiny fairy lights',
    makeup: 'glitter on her cheekbones',
    description: 'Little fairy wings, a flower crown and a star wand: dreamy, in ten minutes.',
    items: [
      { slot: 'accessory', name: 'Fairy wings', color: 'Iridescent', colorHex: '#D9D2F2', material: 'Translucent film', fit: 'Small, on the back' },
      { slot: 'accessory', name: 'Flower crown', color: 'Lilac', colorHex: '#C8A2C8', material: 'Faux flowers', fit: 'Crown' },
      { slot: 'accessory', name: 'Star wand', color: 'Silver', colorHex: '#C0C4C9', material: 'Plastic', fit: 'Small, held in one hand' },
      ...BLACK_BASE,
    ],
  },
]

export const EDITS: Edit[] = [
  {
    id: 'halloween-2026',
    name: 'The Halloween Edit',
    emoji: '🎃',
    tagline: 'Costumes that make everyone say wow. Try any of them on you.',
    droppedAt: '2026-10-06',
    costumes: true,
    looks: halloween,
  },
  {
    id: 'fall-2026',
    name: 'The Fall Edit',
    emoji: '🍂',
    tagline: 'An American fall: pumpkin patches, game day, leaf peeping and Friendsgiving.',
    droppedAt: '2026-10-06',
    looks: fall,
  },
  {
    id: 'fall-weddings-2026',
    name: 'The Fall Wedding Guest Edit',
    emoji: '💐',
    tagline: 'Barn, vineyard or black tie: what to wear to every fall wedding, never in white.',
    droppedAt: '2026-10-13',
    looks: weddings,
  },
  {
    id: 'zodiac-2026',
    name: 'The Zodiac Costume Edit',
    emoji: '🔮',
    tagline: 'Your Halloween costume by your sign: one black outfit and a few things you can still grab this week.',
    droppedAt: '2026-10-14',
    costumes: true,
    looks: zodiac,
  },
]

// A costume try-on's night: the look's scene and face paint, when its Edit is
// a costume one; null for everything else (drawn in the studio).
export function costumeFor(id: string | null | undefined) {
  const edit = EDITS.find((item) => item.costumes && item.looks.some((look) => look.id === id))
  const look = edit?.looks.find((item) => item.id === id)

  return look ? { scene: look.scene, makeup: look.makeup ?? null } : null
}
