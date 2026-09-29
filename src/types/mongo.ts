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
  // The reports, bought on their own or with Pro annual: yours to keep.
  colorReportAt?: Date | null
  styleReportAt?: Date | null
  // Avarobe Pro (monthly or annual subscription).
  pro?: ProSubscription | null
  // Legacy: the Style Kit of the first price list (everything until then).
  styleKitUntil?: Date | null
  // First purchase of anything (reports, a look pack or Pro).
  paidAt?: Date | null
  // Avatar renders used without Pro (create, redo, adjust, a new haircut).
  freeAvatarRuns?: number
  // Hairstyle renders used without the Style Report or Pro (FREE_HAIR_RUNS).
  freeHairRuns?: number
  // Admins (COMP_EMAILS) testing the app as a regular customer.
  compPaused?: boolean
  // Onboarding emails (modules/lifecycle): when each one went out, and the
  // latest, so they stay spaced out.
  lifecycleEmails?: Partial<Record<LifecycleEmailKind, Date>>
  lifecycleEmailLastAt?: Date | null
  // Opted out of tips and reminders (unsubscribe link or account settings).
  // Account and security emails still go out.
  emailTipsOptOutAt?: Date | null
  // Where this person first came from, as the web saw it at sign-up
  // (first-party analytics); server events inherit it.
  acquisition?: Acquisition | null
}

// A visitor's first touch: the channel and campaign that brought them. Ad
// click ids are kept only as far as offline conversions need them.
export type Acquisition = {
  visitorId: string | null
  channel: AnalyticsChannel
  source: string | null
  medium: string | null
  campaign: string | null
  content: string | null
  term: string | null
  landing: string | null
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  fbclid?: string | null
}

export type AnalyticsChannel = 'meta' | 'google' | 'email' | 'organic' | 'social' | 'referral' | 'direct'

// One first-party analytics event: from the web (page views, clicks, offers
// seen) or from the server (checkouts, payments, paywalls). Never personal
// data: no email, no free text, no IP.
export type AnalyticsEventDocument = {
  _id: ObjectId
  at: Date
  name: string
  origin: 'web' | 'server'
  visitorId: string | null
  sessionId: string | null
  userId: ObjectId | null
  path: string | null
  props: Record<string, string | number | boolean>
  // First touch (acquisition) and this session's touch.
  channel: AnalyticsChannel | null
  campaign: string | null
  content: string | null
  sessionChannel: AnalyticsChannel | null
  mobile: boolean | null
  inApp: boolean | null
}

export type LifecycleEmailKind =
  | 'welcome'
  | 'avatar_nudge'
  | 'looks_nudge'
  // Out of free looks: the offer, then two reminders.
  | 'upgrade_offer'
  | 'upgrade_reminder'
  | 'upgrade_last_call'

export type ProSubscription = {
  subscriptionId: string
  customerId: string | null
  status: string
  interval: 'month' | 'year'
  periodEnd: Date | null
  cancelAtPeriodEnd: boolean
  // Annual plans get their monthly looks from a scheduler: the next drop.
  nextCreditsAt?: Date | null
}

export type PurchaseProduct =
  | 'color_report'
  | 'style_report'
  | 'reports_bundle'
  // The other report at the bundle price, soon after buying one.
  | 'color_addon'
  | 'style_addon'
  | 'look_pack'
  | 'pro_monthly'
  | 'pro_annual'

// Products of the first price list (Sep 2026), found in old records only.
export type LegacyPurchaseProduct = 'style_kit' | 'top_up' | 'kit_upgrade' | 'plus'

// One payment. The unique stripeSessionId (a Checkout session id, or the
// invoice id for Plus months) makes granting idempotent: the success page and
// the webhook can both report the same payment.
export type PurchaseDocument = {
  _id: ObjectId
  userId: ObjectId
  product: PurchaseProduct | LegacyPurchaseProduct
  stripeSessionId: string
  stripePaymentIntentId: string | null
  amountTotal: number
  currency: string
  credits: number
  createdAt: Date
}

// A visit from a Meta ad, counted by us to see where clicks get lost:
// 'arrived' when the request reaches the web server, 'loaded' when the page
// runs in the browser, 'registered' when that click becomes an account.
// `click` is a hash of the ad click id (fbclid), never the id itself.
export type ArrivalStage = 'arrived' | 'loaded' | 'registered'

export type ArrivalDocument = {
  _id: ObjectId
  stage: ArrivalStage
  click: string | null
  path: string
  campaign: string | null
  content: string | null
  inApp: boolean
  mobile: boolean
  at: Date
}

// One lifecycle email that went out, with what the person did with it:
// opens (a tracking pixel; Apple Mail opens everything on its own, so read
// them as a ceiling), clicks through our redirect, and unsubscribes.
// Purchases are attributed at read time (admin/routes.ts).
export type EmailSendDocument = {
  _id: ObjectId
  userId: ObjectId
  kind: LifecycleEmailKind
  subject: string
  sentAt: Date
  // Set by the first open or click ($min on a missing field).
  opens: number
  firstOpenAt?: Date
  clicks: number
  firstClickAt?: Date
  lastClickAt?: Date
  unsubscribedAt?: Date
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
  // 'hair': the same avatar with a new haircut from the Hair studio.
  source: 'create' | 'refine' | 'hair'
  createdAt: Date
  // A haircut that isn't the one in the selfie: renders from this version
  // use it instead (`refKey` is a close-up of it, owned by the avatar).
  hair?: AvatarHair | null
}

export type AvatarHair = {
  hairstyleId: string
  name: string
  // What the image model is told the haircut is.
  render: string
  refKey: string
}

// The generation in flight, so the app can show real progress: the palette
// lands first, then previews of the render as the model refines it.
export type AvatarJob = {
  kind: 'create' | 'refine' | 'hair'
  startedAt: Date
  previewKey: string | null
  previewCount: number
  // 'hair': the hairstyle being put on the avatar.
  hairstyleId?: string | null
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
  // The Hair studio's read of the selfie (face shape, hair type and the cuts
  // that suit them). Follows the selfie, like the color report.
  hairProfile?: HairProfileState | null
  consentVersion: string
  consentAt: Date
  generations: number
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
}

export type HairLength = 'short' | 'medium' | 'long'

// One cut picked for the person. `render` is written for the image model;
// `stylistBrief` is what they can show at the salon.
export type HairRecommendation = {
  id: string
  name: string
  length: HairLength
  why: string
  maintenance: 'low' | 'medium' | 'high'
  stylingMinutes: number
  stylistBrief: string
  render: string
}

export type HairProfile = {
  faceShape: string
  faceShapeNote: string
  hairType: { texture: string; density: string; currentLength: HairLength; currentCut: string }
  summary: string
  flatters: string[]
  avoid: string[]
  // Best first: the first one is "your ideal cut".
  recommendations: HairRecommendation[]
}

export type HairProfileState = {
  status: GenerationStatus
  data: HairProfile | null
  error: string | null
  startedAt: Date
  updatedAt: Date
}

// How a haircut the person asked for (not one of the recommendations) works
// for them: 'great', 'good' or 'tricky', and why.
export type HairFit = { verdict: 'great' | 'good' | 'tricky'; note: string }

// One haircut rendered on the person (a chest-up portrait): one of their
// recommendations, a style they described, or one from a photo.
export type HairstyleDocument = {
  _id: ObjectId
  userId: ObjectId
  avatarId: ObjectId
  source: 'recommended' | 'described' | 'photo'
  recommendationId: string | null
  name: string
  why: string | null
  stylistBrief: string | null
  fit: HairFit | null
  render: string
  // What they typed, and the photo they uploaded (only its haircut is used).
  request: string | null
  referenceKey: string | null
  status: GenerationStatus
  error: string | null
  imageKey: string | null
  previewKey: string | null
  // What rendering it took, given back if it fails: a look credit (styles
  // they asked for, with Pro) or their free hairstyle.
  creditSpent: boolean
  freeRun: boolean
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
  // 'locked': a look the stylist designed past the person's last credit,
  // shown with its pieces but not drawn until they unlock it.
  status: GenerationStatus | 'locked'
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
  // When its render last started, if not at creation (a retry or unlock).
  renderStartedAt?: Date | null
  readyAt: Date | null
}

export type CollectionDocument = {
  _id: ObjectId
  userId: ObjectId
  name: string
  createdAt: Date
  updatedAt: Date
}

export type UsageKind = 'avatar' | 'look' | 'pieces' | 'shop' | 'report' | 'hair'

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
