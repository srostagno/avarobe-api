import type { LookItem, Presentation } from '../../types/mongo.js'

// Icon looks: try-on references inspired by iconic style archetypes and eras.
// Names and likenesses of real people are licensed (right of publicity), so a
// look is named by its aesthetic and worn by one of Avarobe's fictional demo
// people (design/ai-samples/diverse/<person>). No real person is named or
// rendered, and garments carry no logos, brands or prints.
//
// The images come from design/ai-samples/icons/generate.mts, which reads this
// list: public/icon-looks/<id>.webp in the web for display, and
// assets/icon-looks/<id>.jpg here as the try-on reference. Keep this file free
// of runtime imports so that script can load it directly.

export type IconLook = {
  id: string
  presentation: Exclude<Presentation, 'unisex'>
  name: string
  era: string
  mood: string
  // One line on the attitude of the look.
  description: string
  // The demo person who wears it.
  person: string
  items: LookItem[]
}

// In display order: the first cards mix people and moods.
export const ICON_LOOKS: IconLook[] = [
  {
    id: 'sixties-cool',
    presentation: 'menswear',
    name: 'Sixties Cool',
    era: '1960s',
    mood: 'Weekend daytime',
    description: 'Understated and unbothered: a cropped zip jacket, clean basics and suede boots.',
    person: 'marcus',
    items: [
      { slot: 'outerwear', name: 'Harrington jacket', color: 'Navy', colorHex: '#1F2A44', material: 'Cotton twill', fit: 'Regular, cropped at the waist, stand collar, worn open' },
      { slot: 'top', name: 'Crew-neck T-shirt', color: 'White', colorHex: '#F4F2EC', material: 'Cotton jersey', fit: 'Slim' },
      { slot: 'bottom', name: 'Chinos', color: 'Khaki', colorHex: '#C3B08A', material: 'Cotton twill', fit: 'Slim, tapered, ankle length' },
      { slot: 'shoes', name: 'Desert boots', color: 'Sand', colorHex: '#C9AE85', material: 'Suede', fit: 'Ankle height, crepe sole' },
      { slot: 'accessory', name: 'Sunglasses', color: 'Tortoiseshell', colorHex: '#6E4A2E', material: 'Acetate', fit: 'Square frame, hooked on the T-shirt collar' },
    ],
  },
  {
    id: 'rock-classic',
    presentation: 'menswear',
    name: 'Rock Classic',
    era: '1970s',
    mood: 'Concert night',
    description: 'Leather, black denim and boots: the uniform that never goes out of style.',
    person: 'kenji',
    items: [
      { slot: 'outerwear', name: 'Biker jacket', color: 'Black', colorHex: '#151515', material: 'Leather', fit: 'Fitted, asymmetric zip, worn open' },
      { slot: 'top', name: 'Crew-neck T-shirt', color: 'Faded black', colorHex: '#2A2A2A', material: 'Cotton jersey', fit: 'Regular, plain with no print' },
      { slot: 'bottom', name: 'Slim jeans', color: 'Black', colorHex: '#1B1B1D', material: 'Stretch denim', fit: 'Slim, tapered' },
      { slot: 'accessory', name: 'Belt', color: 'Black', colorHex: '#161616', material: 'Leather', fit: 'Classic width, silver buckle' },
      { slot: 'shoes', name: 'Engineer boots', color: 'Black', colorHex: '#121212', material: 'Leather', fit: 'Round toe, buckle strap, under the jeans' },
    ],
  },
  {
    id: 'riviera-summer',
    presentation: 'menswear',
    name: 'Riviera Summer',
    era: '1950s',
    mood: 'Summer vacation',
    description: 'Sun-washed Mediterranean ease: an airy knit, pleated linen and bare ankles.',
    person: 'diego',
    items: [
      { slot: 'top', name: 'Knit polo shirt', color: 'Butter yellow', colorHex: '#EAD9A0', material: 'Open-weave cotton', fit: 'Relaxed, short sleeves, open collar' },
      { slot: 'bottom', name: 'Pleated trousers', color: 'Cream', colorHex: '#EFE8DA', material: 'Linen', fit: 'High-waisted, wide leg, cuffed hem' },
      { slot: 'accessory', name: 'Belt', color: 'Tan', colorHex: '#A87C50', material: 'Braided leather', fit: 'Slim' },
      { slot: 'shoes', name: 'Driving moccasins', color: 'Tobacco', colorHex: '#7B5234', material: 'Suede', fit: 'Soft, pebble sole, worn without socks' },
    ],
  },
  {
    id: 'ivy-prep',
    presentation: 'menswear',
    name: 'Ivy Prep',
    era: '1950s',
    mood: 'Office casual',
    description: 'Button-down, soft tweed and loafers: collegiate polish that never tries too hard.',
    person: 'arjun',
    items: [
      { slot: 'top', name: 'Button-down shirt', color: 'Light blue', colorHex: '#BFD3E6', material: 'Cotton oxford cloth', fit: 'Classic fit, soft collar roll' },
      { slot: 'accessory', name: 'Striped tie', color: 'Navy and burgundy', colorHex: '#2A3350', material: 'Silk repp', fit: 'Diagonal stripes, classic width' },
      { slot: 'layer', name: 'Sport coat', color: 'Brown herringbone', colorHex: '#7A5C43', material: 'Wool tweed', fit: 'Natural shoulders, three-button, worn open' },
      { slot: 'bottom', name: 'Trousers', color: 'Mid grey', colorHex: '#7D7D7B', material: 'Wool flannel', fit: 'Flat front, straight, slight break' },
      { slot: 'shoes', name: 'Penny loafers', color: 'Burgundy', colorHex: '#5B1F24', material: 'Leather', fit: 'Classic' },
    ],
  },
  {
    id: 'mod-london',
    presentation: 'menswear',
    name: 'Mod London',
    era: '1960s',
    mood: 'Night out',
    description: 'Sharp and precise: a narrow suit, a skinny tie and polished boots.',
    person: 'erik',
    items: [
      { slot: 'suit', name: 'Two-button suit', color: 'Charcoal', colorHex: '#3A3D42', material: 'Mohair wool', fit: 'Slim, narrow lapels, trousers cropped at the ankle' },
      { slot: 'top', name: 'Button-down shirt', color: 'White', colorHex: '#F7F7F4', material: 'Cotton poplin', fit: 'Slim' },
      { slot: 'accessory', name: 'Skinny tie', color: 'Black', colorHex: '#141414', material: 'Silk knit', fit: 'Square end' },
      { slot: 'shoes', name: 'Chelsea boots', color: 'Black', colorHex: '#121212', material: 'Polished leather', fit: 'Slim, low heel' },
    ],
  },
  {
    id: 'silver-screen',
    presentation: 'menswear',
    name: 'Silver Screen',
    era: '1930s',
    mood: 'Black tie',
    description: 'Golden-age glamour: an ivory dinner jacket, crisp and cinematic.',
    person: 'kenji',
    items: [
      { slot: 'layer', name: 'Shawl-collar dinner jacket', color: 'Ivory', colorHex: '#F2EADB', material: 'Wool', fit: 'Tailored, single button' },
      { slot: 'top', name: 'Pleated-front dress shirt', color: 'White', colorHex: '#FAFAF7', material: 'Cotton poplin', fit: 'Classic fit, turndown collar' },
      { slot: 'bottom', name: 'Tuxedo trousers', color: 'Black', colorHex: '#121212', material: 'Wool', fit: 'High-waisted, straight, satin side stripe' },
      { slot: 'accessory', name: 'Bow tie', color: 'Black', colorHex: '#111111', material: 'Silk satin', fit: 'Self-tied' },
      { slot: 'shoes', name: 'Oxford shoes', color: 'Black', colorHex: '#0E0E0E', material: 'Patent leather', fit: 'Plain toe' },
    ],
  },
  {
    id: 'workwear-americana',
    presentation: 'menswear',
    name: 'Workwear Americana',
    era: '1940s',
    mood: 'Everyday errands',
    description: 'Built to last: canvas, raw denim and boots that get better with wear.',
    person: 'liam',
    items: [
      { slot: 'outerwear', name: 'Work jacket', color: 'Tan', colorHex: '#A67B4F', material: 'Duck canvas', fit: 'Boxy, corduroy collar, worn open' },
      { slot: 'top', name: 'Pocket T-shirt', color: 'Ecru', colorHex: '#EEE6D3', material: 'Heavyweight cotton', fit: 'Regular' },
      { slot: 'bottom', name: 'Jeans', color: 'Dark indigo', colorHex: '#1F2638', material: 'Raw selvedge denim', fit: 'Straight leg, cuffed hem' },
      { slot: 'accessory', name: 'Belt', color: 'Brown', colorHex: '#5A3A22', material: 'Leather', fit: 'Wide, brass buckle' },
      { slot: 'shoes', name: 'Moc-toe work boots', color: 'Russet', colorHex: '#7A4A28', material: 'Leather', fit: 'Lace-up, white wedge sole' },
    ],
  },
  {
    id: 'downtown-grunge',
    presentation: 'menswear',
    name: 'Downtown Grunge',
    era: '1990s',
    mood: 'Casual hangout',
    description: 'Layered, thrifted and a little undone: plaid, faded denim and combat boots.',
    person: 'arjun',
    items: [
      { slot: 'layer', name: 'Plaid shirt', color: 'Red and black', colorHex: '#9E2B25', material: 'Brushed cotton flannel', fit: 'Oversized, worn open' },
      { slot: 'top', name: 'Crew-neck T-shirt', color: 'Washed grey', colorHex: '#77777A', material: 'Cotton jersey', fit: 'Relaxed, plain with no print' },
      { slot: 'bottom', name: 'Straight-leg jeans', color: 'Light wash', colorHex: '#8FA7C2', material: 'Denim', fit: 'Loose straight leg, worn in, ripped at one knee' },
      { slot: 'shoes', name: 'Combat boots', color: 'Black', colorHex: '#151515', material: 'Leather', fit: 'Lace-up, chunky sole' },
    ],
  },
  {
    id: 'western-revival',
    presentation: 'menswear',
    name: 'Western Revival',
    era: '1970s',
    mood: 'Country weekend',
    description: 'Pearl snaps, dark denim and a heeled boot: frontier roots with city polish.',
    person: 'diego',
    items: [
      { slot: 'top', name: 'Western shirt', color: 'Ecru', colorHex: '#EDE3CF', material: 'Cotton twill', fit: 'Regular, pearl snaps, pointed yokes, tucked in' },
      { slot: 'outerwear', name: 'Rancher jacket', color: 'Tan', colorHex: '#A9784C', material: 'Suede', fit: 'Regular, hip length, shearling collar, worn open' },
      { slot: 'bottom', name: 'Straight-leg jeans', color: 'Dark indigo', colorHex: '#26324A', material: 'Rigid denim', fit: 'Straight leg, stacked over the boots' },
      { slot: 'accessory', name: 'Western belt', color: 'Dark brown', colorHex: '#4B3021', material: 'Tooled leather', fit: 'Silver oval buckle' },
      { slot: 'shoes', name: 'Cowboy boots', color: 'Cognac', colorHex: '#8A4B27', material: 'Leather', fit: 'Pointed toe, stacked heel' },
    ],
  },
  {
    id: 'quiet-luxury',
    presentation: 'menswear',
    name: 'Quiet Luxury',
    era: '2020s',
    mood: 'Dinner out',
    description: 'No logos, no noise: soft neutrals and rich fabrics do all the talking.',
    person: 'marcus',
    items: [
      { slot: 'top', name: 'Fine-knit turtleneck', color: 'Cream', colorHex: '#EDE6D6', material: 'Merino wool', fit: 'Slim' },
      { slot: 'layer', name: 'Unstructured blazer', color: 'Camel', colorHex: '#B8875A', material: 'Wool and cashmere', fit: 'Soft shoulders, single-breasted, worn open' },
      { slot: 'bottom', name: 'Pleated trousers', color: 'Mid grey', colorHex: '#8E8D89', material: 'Wool flannel', fit: 'Single pleat, relaxed straight leg' },
      { slot: 'shoes', name: 'Loafers', color: 'Dark brown', colorHex: '#4A3325', material: 'Suede', fit: 'Unlined, slim sole' },
    ],
  },
  {
    id: 'old-hollywood-glam',
    presentation: 'womenswear',
    name: 'Old Hollywood Glam',
    era: '1930s',
    mood: 'Black tie',
    description: 'Liquid satin and soft fur: red-carpet glamour from the golden age.',
    person: 'sofia',
    items: [
      { slot: 'dress', name: 'Bias-cut gown', color: 'Champagne', colorHex: '#E6D2AE', material: 'Silk satin', fit: 'Floor-length, cowl neckline, fluid' },
      { slot: 'accessory', name: 'Stole', color: 'Ivory', colorHex: '#F1EBDF', material: 'Faux fur', fit: 'Draped low around the arms' },
      { slot: 'accessory', name: 'Drop earrings', color: 'Ivory', colorHex: '#F3EEE4', material: 'Pearl and gold', fit: 'Long' },
      { slot: 'bag', name: 'Box clutch', color: 'Gold', colorHex: '#C8A45C', material: 'Metallic leather', fit: 'Small, held in hand' },
      { slot: 'shoes', name: 'Strappy sandals', color: 'Gold', colorHex: '#C8A45C', material: 'Metallic leather', fit: 'High heel' },
    ],
  },
  {
    id: 'parisian-ease',
    presentation: 'womenswear',
    name: 'Parisian Ease',
    era: '1960s',
    mood: 'Weekend in the city',
    description: 'Stripes, a trench and good jeans: effortless, never overthought.',
    person: 'mei',
    items: [
      { slot: 'top', name: 'Breton striped top', color: 'Navy and cream', colorHex: '#22304F', material: 'Cotton jersey', fit: 'Relaxed, boat neck, long sleeves' },
      { slot: 'outerwear', name: 'Trench coat', color: 'Classic beige', colorHex: '#C8AD86', material: 'Cotton gabardine', fit: 'Belted, knee length, worn open' },
      { slot: 'bottom', name: 'Straight-leg jeans', color: 'Mid blue', colorHex: '#5B7BA6', material: 'Denim', fit: 'High-waisted, cropped at the ankle' },
      { slot: 'shoes', name: 'Loafers', color: 'Black', colorHex: '#151515', material: 'Leather', fit: 'Classic' },
      { slot: 'bag', name: 'Crossbody bag', color: 'Tan', colorHex: '#A0724A', material: 'Leather', fit: 'Small' },
    ],
  },
  {
    id: 'seventies-boho',
    presentation: 'womenswear',
    name: 'Seventies Boho',
    era: '1970s',
    mood: 'Weekend brunch',
    description: 'Suede, fringe and flares: sun-warmed and free-spirited.',
    person: 'nora',
    items: [
      { slot: 'top', name: 'Peasant blouse', color: 'Cream', colorHex: '#F2E8D5', material: 'Cotton gauze', fit: 'Relaxed, balloon sleeves, tie neckline' },
      { slot: 'outerwear', name: 'Fringe jacket', color: 'Caramel', colorHex: '#A86B3C', material: 'Suede', fit: 'Regular, fringed sleeves and yoke, worn open' },
      { slot: 'bottom', name: 'Flared jeans', color: 'Mid wash', colorHex: '#5E7FA8', material: 'Denim', fit: 'High-waisted, wide flare' },
      { slot: 'shoes', name: 'Platform clogs', color: 'Tan', colorHex: '#B98B5E', material: 'Leather', fit: 'Closed toe, wooden platform sole' },
      { slot: 'accessory', name: 'Layered necklaces', color: 'Gold', colorHex: '#C9A04E', material: 'Metal', fit: 'Long, three strands' },
    ],
  },
  {
    id: 'nineties-minimal',
    presentation: 'womenswear',
    name: 'Nineties Minimal',
    era: '1990s',
    mood: 'Dinner date',
    description: 'Pared back and quietly confident: a slip dress and a sharp blazer.',
    person: 'imani',
    items: [
      { slot: 'dress', name: 'Slip dress', color: 'Black', colorHex: '#141414', material: 'Silk satin', fit: 'Bias-cut, midi, thin straps' },
      { slot: 'layer', name: 'Oversized blazer', color: 'Charcoal', colorHex: '#3C3C3E', material: 'Wool', fit: 'Boxy, single-breasted, worn open' },
      { slot: 'shoes', name: 'Square-toe mules', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Low block heel' },
      { slot: 'bag', name: 'Mini shoulder bag', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Short strap' },
    ],
  },
  {
    id: 'gamine-classic',
    presentation: 'womenswear',
    name: 'Gamine Classic',
    era: '1950s',
    mood: 'Gallery afternoon',
    description: 'Clean lines, cropped trousers and flats: chic with a dancer’s ease.',
    person: 'helen',
    items: [
      { slot: 'top', name: 'Boat-neck top', color: 'Navy', colorHex: '#2F3A56', material: 'Fine-knit cotton', fit: 'Fitted, three-quarter sleeves' },
      { slot: 'bottom', name: 'Cigarette trousers', color: 'Black', colorHex: '#151515', material: 'Stretch cotton', fit: 'Slim, high-waisted, cropped at the ankle' },
      { slot: 'accessory', name: 'Neck scarf', color: 'Dusty rose', colorHex: '#C48E96', material: 'Silk', fit: 'Small, knotted at the side of the neck' },
      { slot: 'shoes', name: 'Ballet flats', color: 'Black', colorHex: '#141414', material: 'Leather', fit: 'Round toe, thin sole' },
      { slot: 'bag', name: 'Small handbag', color: 'Taupe', colorHex: '#8B7D6B', material: 'Leather', fit: 'Structured, short handle' },
    ],
  },
  {
    id: 'fifties-sweetheart',
    presentation: 'womenswear',
    name: 'Fifties Sweetheart',
    era: '1950s',
    mood: 'Garden party',
    description: 'A cinched waist, a full skirt and a little cardigan: sweet and polished.',
    person: 'ava',
    items: [
      { slot: 'dress', name: 'Fit-and-flare dress', color: 'Light aqua', colorHex: '#9FD3CB', material: 'Cotton poplin', fit: 'Sweetheart neckline, fitted bodice, full midi skirt' },
      { slot: 'layer', name: 'Cardigan', color: 'Warm ivory', colorHex: '#F6EBD9', material: 'Fine-knit cotton', fit: 'Cropped, worn open' },
      { slot: 'accessory', name: 'Skinny belt', color: 'Tan', colorHex: '#B08560', material: 'Leather', fit: 'Cinched at the waist' },
      { slot: 'shoes', name: 'Kitten heels', color: 'Warm beige', colorHex: '#D9B99B', material: 'Leather', fit: 'Pointed toe' },
      { slot: 'bag', name: 'Basket bag', color: 'Natural', colorHex: '#D2B48C', material: 'Woven wicker', fit: 'Small, top handle' },
    ],
  },
  {
    id: 'disco-night',
    presentation: 'womenswear',
    name: 'Disco Night',
    era: '1970s',
    mood: 'Party night',
    description: 'High shine and wide legs, made for the dance floor.',
    person: 'mei',
    items: [
      { slot: 'dress', name: 'Halter jumpsuit', color: 'Fuchsia', colorHex: '#C2185B', material: 'Satin', fit: 'Fitted bodice, open back, wide flared legs' },
      { slot: 'accessory', name: 'Hoop earrings', color: 'Silver', colorHex: '#C0C0C0', material: 'Metal', fit: 'Large' },
      { slot: 'bag', name: 'Envelope clutch', color: 'Silver', colorHex: '#BFC1C2', material: 'Metallic leather', fit: 'Slim' },
      { slot: 'shoes', name: 'Platform sandals', color: 'Silver', colorHex: '#BFC1C2', material: 'Metallic leather', fit: 'High block heel' },
    ],
  },
  {
    id: 'eighties-power',
    presentation: 'womenswear',
    name: 'Eighties Power',
    era: '1980s',
    mood: 'Big meeting',
    description: 'Big shoulders and a bold color: dressed for the corner office.',
    person: 'sofia',
    items: [
      { slot: 'suit', name: 'Double-breasted pantsuit', color: 'Brick red', colorHex: '#A23B2A', material: 'Wool crepe', fit: 'Strong padded shoulders, oversized jacket, high-waisted pleated trousers' },
      { slot: 'top', name: 'Pussy-bow blouse', color: 'Ivory', colorHex: '#F3ECDF', material: 'Silk', fit: 'Relaxed, bow tied at the neck' },
      { slot: 'accessory', name: 'Statement earrings', color: 'Gold', colorHex: '#C9A04E', material: 'Metal', fit: 'Chunky, button style' },
      { slot: 'shoes', name: 'Pumps', color: 'Black', colorHex: '#151515', material: 'Leather', fit: 'Pointed toe, mid heel' },
      { slot: 'bag', name: 'Top-handle bag', color: 'Black', colorHex: '#151515', material: 'Leather', fit: 'Structured, boxy' },
    ],
  },
  {
    id: 'capri-summer',
    presentation: 'womenswear',
    name: 'Capri Summer',
    era: '1960s',
    mood: 'Lunch by the sea',
    description: 'Crisp white, a pop of red and espadrilles: a long lunch by the sea.',
    person: 'imani',
    items: [
      { slot: 'top', name: 'Button-up shirt', color: 'White', colorHex: '#F7F5F0', material: 'Linen', fit: 'Relaxed, sleeves rolled, knotted at the waist' },
      { slot: 'bottom', name: 'Capri pants', color: 'True red', colorHex: '#B3122E', material: 'Cotton twill', fit: 'High-waisted, slim, cropped at mid-calf' },
      { slot: 'shoes', name: 'Espadrille flats', color: 'Natural', colorHex: '#E2D3B5', material: 'Canvas and jute', fit: 'Ankle ties' },
      { slot: 'bag', name: 'Tote', color: 'Natural', colorHex: '#D8C18F', material: 'Woven straw', fit: 'Structured, top handles' },
      { slot: 'accessory', name: 'Sunglasses', color: 'Black', colorHex: '#121212', material: 'Acetate', fit: 'Cat-eye frame, hooked on the shirt' },
    ],
  },
  {
    id: 'dark-academia',
    presentation: 'womenswear',
    name: 'Dark Academia',
    era: '2020s',
    mood: 'Fall weekday',
    description: 'Tweed, plaid and a leather satchel: scholarly layers in autumn tones.',
    person: 'helen',
    items: [
      { slot: 'layer', name: 'Blazer', color: 'Brown herringbone', colorHex: '#6F5440', material: 'Wool tweed', fit: 'Relaxed, single-breasted, worn open' },
      { slot: 'top', name: 'Turtleneck', color: 'Cream', colorHex: '#EFE6D2', material: 'Fine merino', fit: 'Fitted' },
      { slot: 'bottom', name: 'Pleated skirt', color: 'Burgundy and forest plaid', colorHex: '#5B2530', material: 'Wool', fit: 'Midi, knife pleats' },
      { slot: 'shoes', name: 'Oxford brogues', color: 'Dark brown', colorHex: '#3E2A1E', material: 'Leather', fit: 'Lace-up, chunky sole' },
      { slot: 'bag', name: 'Satchel', color: 'Cognac', colorHex: '#8A4B2A', material: 'Leather', fit: 'Crossbody, buckled flap' },
    ],
  },
]
