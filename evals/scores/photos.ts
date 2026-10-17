// The fictional test photos for evals/scores (Oct 17, 2026): text prompts
// only (never a real person), each with the label it was made to be, so the
// eval can check the score ranks them the same way. Looks: 3 poor, 4
// average, 3 good, 2 excellent. Hair: 2 poor, 3 average, 3 good (hair-07 is
// natural silver in great condition: gray must not cost points).

export const PHOTO_DIR = '/Users/silvio/Documents/Projects/Avarobe/design/products/2026-10-score-evals'

export type Label = 'poor' | 'average' | 'good' | 'excellent'
export type TestPhoto = { id: string; kind: 'look' | 'hair'; label: Label; note: string; prompt: string }

export const LABEL_ORDER: Label[] = ['poor', 'average', 'good', 'excellent']

const LOOK_STYLE =
  'Realistic, candid, unretouched everyday smartphone photo with ordinary light and slight phone-camera grain, not a professional fashion shoot. The whole body is visible from head to shoes.'
const HAIR_STYLE =
  'Realistic, unretouched everyday smartphone selfie with ordinary light and slight phone-camera grain, not a professional shoot. Head and shoulders, the whole hair clearly visible.'

const look = (id: string, label: Label, note: string, scene: string): TestPhoto => ({ id, kind: 'look', label, note, prompt: `${scene} ${LOOK_STYLE}` })
const hair = (id: string, label: Label, note: string, scene: string): TestPhoto => ({ id, kind: 'hair', label, note, prompt: `${scene} ${HAIR_STYLE}` })

export const PHOTOS: TestPhoto[] = [
  look(
    'look-01',
    'poor',
    '58, white, heavier build; clashing paisley blouse pulling at buttons, short lime trousers, dirty sneakers',
    'Amateur smartphone mirror selfie in a cluttered bedroom with a wardrobe mirror, warm ceiling-lamp light. A fictional 58-year-old white woman with a heavier build and shoulder-length dyed auburn hair holds her phone at chest height, her face visible. Her outfit is poorly put together: a busy orange-and-purple paisley blouse that pulls and gapes between the buttons, tucked unevenly into lime-green pleated trousers that are too short and wrinkled, with scuffed grey running shoes and dirty laces. The clothes are creased and the colors clash.',
  ),
  look(
    'look-02',
    'poor',
    '66, Black, slim; stretched stained sweatshirt two sizes too big, bunching jeans, worn clogs, shapeless cardigan',
    'Amateur photo taken by a friend on a phone on a suburban sidewalk on an overcast afternoon. A fictional 66-year-old Black woman with a slim build and short natural gray hair stands casually. Her outfit is sloppy and ill-fitting: a faded, pilled, stretched-out maroon sweatshirt two sizes too big with a small stain on the front, baggy light-wash jeans that are too long and bunch in folds over worn-out brown clogs, and a shapeless mustard cardigan with sagging pockets on top. Everything swamps her and looks creased and dated.',
  ),
  look(
    'look-03',
    'poor',
    '50, Latina, curvy; too-tight mustard top, neon floral skirt, tube socks with heels, jacket tied at waist',
    'Amateur smartphone mirror selfie in a narrow hallway with a full-length mirror, plain daylight from a window. A fictional 50-year-old Latina woman with a curvy figure and long dark hair in a messy ponytail. Her outfit is dated and badly fitted: a too-tight mustard ribbed top that rides up and pulls across the middle, a shiny neon-pink floral tiered skirt that clashes with it, white tube socks with black patent heels, a worn denim jacket with frayed cuffs tied around her waist, and a cheap printed tote bag. Wrinkled and clashing.',
  ),
  look(
    'look-04',
    'average',
    '52, East Asian, slim; navy tee, straight jeans, white canvas sneakers, crossbody',
    'Amateur photo taken by a friend on a phone on a city street, cloudy daylight. A fictional 52-year-old East Asian woman with a slim build and chin-length black hair. She wears a plain navy crew-neck t-shirt, regular mid-blue straight jeans that fit fine, white canvas sneakers and a small black crossbody bag. Clean and neat but generic and unremarkable.',
  ),
  look(
    'look-05',
    'average',
    '61, white, plus-size; black leggings, long grey tunic, ballet flats',
    'Amateur smartphone mirror selfie in a living room with a full-length mirror, ordinary lamp light. A fictional 61-year-old white woman with a plus-size figure and short blonde hair holds her phone at chest height, her face visible. She wears black leggings, a long loose heather-grey tunic top to mid-thigh and flat black ballet flats, with a simple silver necklace. Comfortable and tidy, safe but unremarkable.',
  ),
  look(
    'look-06',
    'average',
    '68, South Asian, average build; beige trousers, blue shirt, navy cardigan, walking shoes',
    'Amateur photo taken by a friend on a phone on a neighborhood street by parked cars, soft overcast light. A fictional 68-year-old South Asian woman with an average build and gray hair in a low bun. She wears straight beige trousers, a light blue button-down shirt, a navy cardigan and black comfortable walking shoes, with a brown shoulder bag. Neat and acceptable but a little plain and old-fashioned.',
  ),
  look(
    'look-07',
    'average',
    '47, Black, curvy; black jersey dress, grey cardigan, flat sandals',
    'Amateur smartphone mirror selfie in a bedroom, ordinary daylight from a window. A fictional 47-year-old Black woman with a curvy figure and shoulder-length braids holds her phone at chest height, her face visible. She wears a simple knee-length black jersey dress, an open grey cardigan and basic black flat sandals, with a small black handbag. Fine and coherent, nothing wrong but generic.',
  ),
  look(
    'look-08',
    'good',
    '55, white, red hair, average build; camel trench, cream knit, dark jeans, loafers, cognac tote',
    'Amateur photo taken by a friend on a phone on a city sidewalk, ordinary overcast daylight. A fictional 55-year-old white woman with an average build and shoulder-length copper-red hair. She wears a well-fitted camel trench coat open over a cream fine-knit sweater, dark straight-leg jeans hemmed at the ankle, tan leather loafers and a cognac leather tote. Polished, current and well fitted; the warm colors flatter her coloring.',
  ),
  look(
    'look-09',
    'good',
    '63, Middle Eastern, plus-size; emerald wrap dress, nude block heels, gold hoops',
    'Amateur smartphone mirror selfie in a tidy entryway with a full-length mirror, ordinary indoor light. A fictional 63-year-old Middle Eastern woman with a plus-size figure and dark wavy shoulder-length hair holds her phone at chest height, her face visible. She wears a well-fitting emerald-green wrap dress to below the knee, nude block-heel pumps, gold hoop earrings and a small structured tan bag. Flattering, polished and coherent.',
  ),
  look(
    'look-10',
    'good',
    '49, Black, tall slim; tailored navy wide-leg trousers, crisp white shirt, tan belt, white leather sneakers',
    'Amateur photo taken by a friend on a phone in front of a brick building, plain daylight. A fictional 49-year-old Black woman, tall and slim, with a short natural cropped haircut. She wears tailored navy wide-leg trousers, a crisp white button-down shirt with the sleeves neatly rolled, a slim tan leather belt, clean white leather sneakers and small gold earrings. Polished, modern and well fitted.',
  ),
  look(
    'look-11',
    'excellent',
    '58, East Asian, petite; tailored cobalt suit, ivory silk shell, nude pumps, gold sculptural earrings',
    'Amateur photo taken by a friend on a phone on a city street, ordinary daylight. A fictional 58-year-old East Asian woman, petite and slim, with a sleek chin-length bob. She wears an impeccably tailored cobalt-blue blazer and matching cropped straight trousers, an ivory silk shell top, pointed nude leather pumps, a structured cream handbag and bold gold sculptural earrings. Every detail chosen, a perfect fit, a striking color that lights up her face, modern and intentional.',
  ),
  look(
    'look-12',
    'excellent',
    '67, white, curvy, silver bob; rust knit midi dress, tailored camel coat, brown knee boots, silk scarf',
    'Amateur photo taken by a friend on a phone on a tree-lined street in autumn, ordinary overcast daylight. A fictional 67-year-old white woman with a curvy figure and a chic silver bob. She wears a rust-terracotta ribbed midi knit dress with a slim belt at the waist, a perfectly tailored long camel coat, chocolate-brown leather knee boots, a patterned silk scarf in rust and cream, and a cognac bag. A deliberate, harmonious palette, impeccable fit, an elongating silhouette, effortlessly chic.',
  ),
  hair(
    'hair-01',
    'poor',
    '57, white; box-dyed dark brown, 2 in. gray roots, brassy, frizzy ends, shapeless',
    'Amateur smartphone selfie at home, ordinary bathroom light. A fictional 57-year-old white woman with shoulder-length box-dyed dark brown hair showing about two inches of gray grown-out roots at the parting, dry frizzy split ends, brassy orange tones in the lengths, and a shapeless, heavy one-length cut hanging flat.',
  ),
  hair(
    'hair-02',
    'poor',
    '64, Latina; grown-out dated perm, frizzy triangle shape, faded brassy highlights',
    'Amateur smartphone selfie in a kitchen, ordinary daylight. A fictional 64-year-old Latina woman with a dated 1980s-style tight perm that has grown out: frizzy, puffy and triangular at the ends, flat at the roots, with faded brassy yellow highlights and a dull, dry texture.',
  ),
  hair(
    'hair-03',
    'average',
    '50, South Asian; long black hair in a loose low ponytail, flyaways, no particular cut',
    'Amateur smartphone selfie in a living room, ordinary window light. A fictional 50-year-old South Asian woman with long straight black hair pulled back loosely into a low ponytail, a center parting, a few flyaways, decent but unremarkable condition, no particular cut or styling.',
  ),
  hair(
    'hair-04',
    'average',
    '61, white; ash-blonde bob two months past its cut, flat crown',
    'Amateur smartphone selfie at home, ordinary lamp light. A fictional 61-year-old white woman with an ash-blonde chin-length bob a couple of months past its cut, a little flat at the crown, a simple side parting, fine condition, a bit plain.',
  ),
  hair(
    'hair-05',
    'average',
    '68, East Asian; short practical cut, dark with scattered gray, unstyled',
    'Amateur smartphone selfie on a balcony, overcast daylight. A fictional 68-year-old East Asian woman with a short practical layered cut, dark hair with scattered gray, neatly combed, average condition, not styled, timeless but unremarkable.',
  ),
  hair(
    'hair-06',
    'good',
    '53, Black; natural coils in a fresh tapered cut, defined and shiny',
    'Amateur smartphone selfie at home by a window, soft daylight. A fictional 53-year-old Black woman with natural coily hair in a fresh tapered cut, defined shiny coils with volume on top, neat edges, healthy and moisturized.',
  ),
  hair(
    'hair-07',
    'good',
    '66, white; natural bright silver bob, fresh cut, glossy, no yellowing (the gray check)',
    'Amateur smartphone selfie in a hallway, ordinary daylight. A fictional 66-year-old white woman with natural bright silver-white hair in a freshly cut, chic chin-length bob with soft movement, glossy and smooth, a cool bright tone with no yellowing, in excellent condition.',
  ),
  hair(
    'hair-08',
    'good',
    '47, Latina; fresh long layers, glossy caramel balayage, bouncy blow-dry',
    'Amateur smartphone selfie in a bedroom, ordinary window light. A fictional 47-year-old Latina woman with freshly cut long layers and face-framing pieces, a glossy dimensional caramel-brown balayage and a smooth, bouncy blow-dry with movement, healthy shiny ends.',
  ),
]
