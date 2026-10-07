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
// no runtime imports.

export type EditLook = IconLook & {
  // Where the catalog photo is set (for the image generator).
  scene: string
  // A ready image instead of a generated one (path under design/).
  source?: string
}

export type Edit = {
  id: string
  name: string
  emoji: string
  // One line under the name.
  tagline: string
  // When it dropped (YYYY-MM-DD); shown as new for a week.
  droppedAt: string
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
const GRETA = 'ads/2026-10-halloween-wow/src/stills'

const halloween: EditLook[] = [
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
    id: 'hw-spider-queen', presentation: 'womenswear', name: 'Spider Queen', era: HALLOWEEN, mood: 'Costume party', person: 'greta', source: `${GRETA}/spider.png`,
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
    id: 'hw-black-swan', presentation: 'womenswear', name: 'Black Swan', era: HALLOWEEN, mood: 'Costume party', person: 'ava',
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
    id: 'hw-ghost-bride', presentation: 'womenswear', name: 'Ghost Bride', era: HALLOWEEN, mood: 'Costume party', person: 'helen',
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
    id: 'hw-ice-queen', presentation: 'womenswear', name: 'Ice Queen', era: HALLOWEEN, mood: 'Costume party', person: 'imani',
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
const weddings: EditLook[] = [
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

export const EDITS: Edit[] = [
  {
    id: 'halloween-2026',
    name: 'The Halloween Edit',
    emoji: '🎃',
    tagline: 'Costumes that make everyone say wow. Try any of them on you.',
    droppedAt: '2026-10-06',
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
]
