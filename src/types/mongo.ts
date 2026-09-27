import type { Binary, ObjectId } from 'mongodb'

export type UserDocument = {
  _id: ObjectId
  email: string
  firstName: string
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
  emailVerifiedAt: Date | null
  // Hashes of the nonce in the latest verification / reset link. Cleared when
  // the link is used, so each link works once and a new one voids older ones.
  emailVerificationNonceHash?: string | null
  emailVerificationSentAt?: Date | null
  passwordResetNonceHash?: string | null
  passwordResetSentAt?: Date | null
  passwordHash?: string | null
  passwordUpdatedAt?: Date | null
  // Throttles password guessing per account on top of the per-IP rate limit.
  failedLoginCount?: number
  lockedUntil?: Date | null
  // Billing. Missing credits means the sign-up allowance (FREE_CREDITS).
  credits?: number
  styleKitUntil?: Date | null
  // Bought the Color Report: full palette and color report, for good.
  colorReportAt?: Date | null
  // Avarobe Plus (monthly subscription): the Kit while active + monthly credits.
  plus?: PlusSubscription | null
  // Avatar renders used without a Style Kit (create, redo, adjust).
  freeAvatarRuns?: number
  // Admins (COMP_EMAILS) testing the app as a regular customer.
  compPaused?: boolean
}

export type PlusSubscription = {
  subscriptionId: string
  customerId: string | null
  status: string
  periodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export type PurchaseProduct = 'style_kit' | 'top_up' | 'color_report' | 'kit_upgrade' | 'plus'

// One payment. The unique stripeSessionId (a Checkout session id, or the
// invoice id for Plus months) makes granting idempotent: the success page and
// the webhook can both report the same payment.
export type PurchaseDocument = {
  _id: ObjectId
  userId: ObjectId
  product: PurchaseProduct
  stripeSessionId: string
  stripePaymentIntentId: string | null
  amountTotal: number
  currency: string
  credits: number
  kitDays: number
  createdAt: Date
}

// A WebAuthn credential (passkey). The private key stays on the person's
// device; we only keep the public key and the signature counter.
export type PasskeyDocument = {
  _id: ObjectId
  userId: ObjectId
  credentialId: string
  publicKey: Binary
  counter: number
  transports: string[]
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
  name: string
  createdAt: Date
  lastUsedAt: Date | null
}

export type AuthChallengeDocument = {
  _id: string
  purpose: 'passkey_register' | 'passkey_login'
  userId: ObjectId | null
  challenge: string
  expiresAt: Date
}

export type RefreshTokenDocument = {
  _id: ObjectId
  tokenHash: string
  userId: ObjectId
  expiresAt: Date
  revokedAt: Date | null
  replacedByTokenHash: string | null
  createdAt: Date
  createdByIp: string | null
  userAgent: string | null
}

export type Presentation = 'menswear' | 'womenswear' | 'unisex'

export type BodyBuild =
  | 'slim'
  | 'athletic'
  | 'average'
  | 'broad'
  | 'curvy'
  | 'plus'

export type AvatarBody = {
  heightCm: number
  weightKg: number
  build: BodyBuild
  presentation: Presentation
}

export type ColorSwatch = {
  name: string
  hex: string
}

export type ColorAnalysis = {
  season: string
  undertone: 'warm' | 'cool' | 'neutral' | 'olive'
  contrast: 'low' | 'medium' | 'high'
  summary: string
  bestColors: ColorSwatch[]
  neutrals: ColorSwatch[]
  avoidColors: ColorSwatch[]
  metals: 'gold' | 'silver' | 'both'
  confidence: 'low' | 'medium' | 'high'
  photoNote: string | null
}

export type GenerationStatus = 'processing' | 'ready' | 'failed'

export type AvatarVersion = {
  id: string
  key: string
  source: 'create' | 'refine'
  createdAt: Date
}

// The generation in flight, so the app can show real progress: the palette
// lands first, then previews of the render as the model refines it.
export type AvatarJob = {
  kind: 'create' | 'refine'
  startedAt: Date
  previewKey: string | null
  previewCount: number
}

export type AvatarAdjustment =
  | 'more_like_me'
  | 'head_smaller'
  | 'head_larger'
  | 'slimmer'
  | 'fuller'
  | 'broader_shoulders'
  | 'narrower_shoulders'
  | 'match_skin'

export type AvatarDocument = {
  _id: ObjectId
  userId: ObjectId
  status: GenerationStatus
  error: string | null
  selfieKey: string
  // Optional full-body photo; the strongest signal for real proportions.
  bodyPhotoKey?: string | null
  avatarKey: string | null
  // Recent renders, newest first, so a refinement can be undone.
  versions?: AvatarVersion[]
  job?: AvatarJob | null
  body: AvatarBody
  colorAnalysis: ColorAnalysis | null
  // Style Kit reports. The color report and drape test follow the selfie
  // (cleared when it changes); the style profile follows the body.
  colorReport?: { data: ColorReport; createdAt: Date } | null
  drape?: DrapeTest | null
  styleProfile?: { data: StyleProfile; createdAt: Date } | null
  // The visual boards of both reports: one image each, comparing options on
  // the avatar (color boards follow the selfie, style boards the body).
  reportBoards?: Partial<Record<BoardKind, ReportBoard>> | null
  consentVersion: string
  consentAt: Date
  generations: number
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
}

export type ScaleReading = { value: number; label: string }

export type Verdict = 'wear' | 'avoid'

export type TestSwatch = ColorSwatch & { verdict: Verdict }

// A comparison of options near the face or on the body: the insight is the
// headline ("Espresso is your black"), the note explains why.
export type ComparisonTest<T> = { insight: string; note: string; panels: T[] }

export type ColorReport = {
  seasonLean: string
  scales: { undertone: ScaleReading; depth: ScaleReading; chroma: ScaleReading; contrast: ScaleReading }
  palette: { basics: ColorSwatch[]; accents: ColorSwatch[]; statements: ColorSwatch[] }
  combinations: { name: string; occasion: string; colors: ColorSwatch[] }[]
  guides: { title: string; text: string }[]
  avoidAdvice: string
  drape: { wear: ColorSwatch[]; avoid: ColorSwatch[] }
  // Added with the visual report (Sep 2026); older reports lack them.
  coloring?: { skin: string; hair: string; eyes: string }
  signature?: string
  gameChangers?: { title: string; text: string }[]
  neutralsTest?: ComparisonTest<TestSwatch>
  whitesTest?: ComparisonTest<TestSwatch>
  metalsTest?: { best: 'gold' | 'silver' | 'both'; insight: string; note: string }
  faceTest?: ComparisonTest<TestSwatch> & { kind: 'lips' | 'shirts' }
  // 'beard' (menswear) compares facial hair styles instead of hair colors.
  hairTest?: ComparisonTest<TestSwatch> & { current: string; kind?: 'color' | 'beard' }
  paletteLooks?: { name: string; outfit: string }[]
}

export type BoardKind =
  | 'neutrals'
  | 'whites'
  | 'metals'
  | 'face'
  | 'hair'
  | 'palette'
  | 'silhouettes'
  | 'necklines'
  | 'capsule'

// One label per panel, in reading order (left to right, top to bottom).
export type BoardPanel = { label: string; verdict: Verdict | 'current' | null; hex: string | null }

export type ReportBoard = {
  status: GenerationStatus
  key: string | null
  layout: 'grid' | 'pair' | 'single'
  panels: BoardPanel[]
  // What the image shows and what it is drawn from (the face, the full-body
  // avatar, or nothing), kept so a retry renders the same board.
  prompt: string
  refs: 'portrait' | 'body' | 'none'
  size: '1024x1024' | '1536x1024'
  updatedAt: Date
}

// One image of the avatar with four fabric drapes near the face: two colors
// that flatter, two that don't (top row wear, bottom row avoid).
export type DrapeTest = {
  status: GenerationStatus
  key: string | null
  wear: ColorSwatch[]
  avoid: ColorSwatch[]
  updatedAt: Date
}

export type StyleProfile = {
  archetype: string
  tagline: string
  description: string
  keywords: string[]
  shines: { situation: string; why: string }[]
  adapt: { situation: string; how: string }[]
  silhouettes: { area: string; advice: string }[]
  signaturePieces: { name: string; color: string; colorHex: string; why: string }[]
  capsule: { slot: string; name: string; color: string; colorHex: string; material: string }[]
  skip: string[]
  // Added with the visual report (Sep 2026); older profiles lack them.
  silhouetteTest?: ComparisonTest<{ name: string; garment: string; verdict: Verdict }>
  necklineTest?: ComparisonTest<{ name: string; verdict: Verdict }> & { kind: 'necklines' | 'collars' }
  capsuleNote?: string
}

export type LookAnalysis = {
  dressCodeFit: { score: number; verdict: string }
  paletteHarmony: { score: number; verdict: string }
  flatters: string
  strengths: string[]
  dressUp: string
  dressDown: string
  dayToNight: string
  weather: string
  accessories: string[]
}

export type LookItemSlot =
  | 'top'
  | 'layer'
  | 'outerwear'
  | 'bottom'
  | 'dress'
  | 'suit'
  | 'shoes'
  | 'accessory'
  | 'bag'

export type LookItem = {
  slot: LookItemSlot
  name: string
  color: string
  colorHex: string
  material: string
  fit: string
  // Try-ons: false for pieces the stylist added to complete the outfit.
  fromPhoto?: boolean
}

// One garment of a look, rendered on its own as a product photo (no person),
// so it can be searched in stores.
export type LookPiece = {
  id: string
  slot: LookItemSlot
  name: string
  color: string
  colorHex: string
  material: string
  fit: string
  status: GenerationStatus
  imageKey: string | null
}

export type LookPlan = {
  title: string
  vibe: string
  summary: string
  whyItWorks: string
  items: LookItem[]
  stylingTips: string[]
  // What the look took from the person's taste profile ("Boots over sneakers").
  tasteApplied?: string[]
}

// What someone thought of a look. The aspects read with the rating: 'colors'
// on a thumbs up means they loved the colors, on a thumbs down that the
// colors were off. The last four only come with a thumbs down.
export type FeedbackAspect =
  | 'style'
  | 'colors'
  | 'fit'
  | 'occasion'
  | 'too_formal'
  | 'too_casual'
  | 'missed_request'
  | 'weather'

export type LookFeedback = {
  rating: 'up' | 'down'
  aspects: FeedbackAspect[]
  // Pieces they singled out, by index in plan.items.
  pieces: { index: number; vote: 'up' | 'down' }[]
  note: string | null
  at: Date
}

// 'fix' restyles a look the person disliked, from their feedback.
export type RemixChange = 'colors' | 'season' | 'dressier' | 'casual' | 'occasion' | 'surprise' | 'custom' | 'fix'

// One line of a taste profile. 'you' lines were written by the person and
// are never rewritten; 'learned' lines come from their feedback.
export type TasteNote = {
  id: string
  text: string
  source: 'you' | 'learned'
  // How many looks back a learned line up.
  evidence: number
}

// What the stylist knows about someone's taste, one per user. Learning runs
// in the background after feedback; `dirty` asks for one more pass when
// feedback lands during a run.
export type TasteDocument = {
  _id: ObjectId
  userId: ObjectId
  statement: string | null
  summary: string | null
  loves: TasteNote[]
  avoids: TasteNote[]
  // Learned lines the person removed; learning never brings them back.
  dismissed: string[]
  signals: number
  learning: boolean
  dirty: boolean
  learnedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type LookDocument = {
  _id: ObjectId
  userId: ObjectId
  avatarId: ObjectId
  batchId: ObjectId
  occasion: {
    text: string
    dressCode: string
    summary: string
    // What the stylist understood the person asked for, shown back to them.
    asks?: string[]
  }
  plan: LookPlan
  feedback?: LookFeedback | null
  // A variant of another look ("same style, new colors").
  remixOf?: ObjectId | null
  remix?: { change: RemixChange; detail: string | null } | null
  // 'tryon': rendered from an outfit photo the person uploaded.
  source?: 'stylist' | 'tryon'
  referenceKey?: string | null
  // Try-ons of an icon look (modules/looks/icons.ts): which one.
  iconId?: string | null
  status: GenerationStatus
  error: string | null
  imageKey: string | null
  previewKey?: string | null
  // Whether rendering this look took a credit (refunded if it fails).
  creditSpent?: boolean
  analysis?: { data: LookAnalysis; createdAt: Date } | null
  pieces?: LookPiece[]
  collectionIds: ObjectId[]
  favorite: boolean
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
}

export type CollectionDocument = {
  _id: ObjectId
  userId: ObjectId
  name: string
  createdAt: Date
  updatedAt: Date
}

export type UsageKind = 'avatar' | 'look' | 'pieces' | 'shop' | 'report'

export type UsageCounterDocument = {
  _id: string
  userId: ObjectId
  kind: UsageKind
  day: string
  count: number
  expireAt: Date
}

export type ShopMatch = {
  title: string
  link: string
  domain: string
  source: string
  sourceIcon: string | null
  thumbnail: string | null
  price: string | null
  extractedPrice: number | null
  currency: string | null
  inStock: boolean | null
}

// Store matches for one piece in one market, cached so "show more" pages
// through what we already paid for before running another search.
export type ShopSearchDocument = {
  _id: ObjectId
  userId: ObjectId
  lookId: ObjectId
  pieceId: string
  market: string
  results: ShopMatch[]
  // How many of the search passes (see shop/serpapi.ts) have run.
  passes: number
  exhausted: boolean
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
}
