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
  consentVersion: string
  consentAt: Date
  generations: number
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
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
  status: GenerationStatus
  error: string | null
  imageKey: string | null
  previewKey?: string | null
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

export type UsageCounterDocument = {
  _id: string
  userId: ObjectId
  kind: 'avatar' | 'look'
  day: string
  count: number
  expireAt: Date
}
