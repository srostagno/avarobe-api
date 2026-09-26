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
  consentVersion: string
  consentAt: Date
  generations: number
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
}

export type ScaleReading = { value: number; label: string }

export type ColorReport = {
  seasonLean: string
  scales: { undertone: ScaleReading; depth: ScaleReading; chroma: ScaleReading; contrast: ScaleReading }
  palette: { basics: ColorSwatch[]; accents: ColorSwatch[]; statements: ColorSwatch[] }
  combinations: { name: string; occasion: string; colors: ColorSwatch[] }[]
  guides: { title: string; text: string }[]
  avoidAdvice: string
  drape: { wear: ColorSwatch[]; avoid: ColorSwatch[] }
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
  }
  plan: LookPlan
  // 'tryon': rendered from an outfit photo the person uploaded.
  source?: 'stylist' | 'tryon'
  referenceKey?: string | null
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

export type UsageKind = 'avatar' | 'look' | 'pieces' | 'shop'

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
