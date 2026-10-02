import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type {
  AvatarDocument,
  BoardKind,
  BoardPanel,
  ColorReport,
  ColorSwatch,
  ReportBoard,
  StyleProfile,
  TestSwatch,
} from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { toStoredWebp } from '../../utils/images.js'
import { type ImageInput, generateImage, generateImageFromReferences } from '../../utils/openai.js'
import { storage } from '../../utils/storage.js'
import { hairReference } from '../avatar/hair.js'
import {
  buildCapsuleBoardPrompt,
  buildDrapeBoardPrompt,
  buildBeardBoardPrompt,
  buildHairBoardPrompt,
  buildLipsBoardPrompt,
  buildMetalsBoardPrompt,
  buildNecklinesBoardPrompt,
  buildPaletteBoardPrompt,
  buildShirtsBoardPrompt,
  buildSilhouettesBoardPrompt,
  selfieOnly,
} from './prompts.js'

// The visual boards of the reports: one image each, comparing options on the
// person, with the labels drawn by the app. Color boards come with the color
// report and follow the selfie; style boards come with the style profile and
// follow the body.
export const COLOR_BOARDS = ['neutrals', 'whites', 'metals', 'face', 'hair', 'palette'] as const satisfies readonly BoardKind[]
export const STYLE_BOARDS = ['silhouettes', 'necklines', 'capsule'] as const satisfies readonly BoardKind[]
export const BOARD_KINDS: readonly BoardKind[] = [...COLOR_BOARDS, ...STYLE_BOARDS]

// The color boards someone can have now: before the avatar, the ones drawn
// on their face (the outfits board needs their body).
export function colorBoardsFor(avatar: Pick<AvatarDocument, 'avatarKey'>): readonly BoardKind[] {
  return avatar.avatarKey ? COLOR_BOARDS : COLOR_BOARDS.filter((kind) => kind !== 'palette')
}

const BOARD_CONCURRENCY = 3
const HEX = /^#[0-9a-f]{6}$/i

export type BoardSpec = Pick<ReportBoard, 'layout' | 'panels' | 'prompt' | 'refs' | 'size'>

type BoardSource = Pick<AvatarDocument, 'body' | 'colorAnalysis'> & Partial<Pick<AvatarDocument, 'presentation'>>

const swatchPanels = (swatches: TestSwatch[]): BoardPanel[] =>
  swatches.map((swatch) => ({ label: swatch.name, verdict: swatch.verdict, hex: swatch.hex }))

// Four portraits drawn from the avatar and the selfie.
const faceGrid = (panels: BoardPanel[], prompt: string): BoardSpec => ({
  layout: 'grid',
  panels,
  prompt,
  refs: 'portrait',
  size: '1024x1024',
})

// Four full-body photos drawn from the avatar.
const bodyGrid = (panels: BoardPanel[], prompt: string): BoardSpec => ({
  layout: 'grid',
  panels,
  prompt,
  refs: 'body',
  size: '1024x1024',
})

const METALS = {
  gold: { label: 'Gold', hex: '#C9A54C' },
  silver: { label: 'Silver', hex: '#C0C4C8' },
}

// Cuts and necklines read best in a mid-tone: black hides them and white
// blows out.
function midTone(swatches: ColorSwatch[]): ColorSwatch {
  const lightness = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16)

    return (0.299 * (value >> 16) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255
  }

  const [closest] = swatches
    .filter((swatch) => HEX.test(swatch.hex))
    .sort((a, b) => Math.abs(lightness(a.hex) - 0.55) - Math.abs(lightness(b.hex) - 0.55))

  return closest ?? { name: 'camel', hex: '#C19A6B' }
}

// Each builder returns null when the report lacks its test (older reports)
// or the test came back short.
const colorBoards: Record<(typeof COLOR_BOARDS)[number], (report: ColorReport, source: BoardSource) => BoardSpec | null> = {
  neutrals: ({ neutralsTest: test }) =>
    test?.panels.length === 4 ? faceGrid(swatchPanels(test.panels), buildDrapeBoardPrompt(test.panels)) : null,
  whites: ({ whitesTest: test }) =>
    test?.panels.length === 4 ? faceGrid(swatchPanels(test.panels), buildDrapeBoardPrompt(test.panels)) : null,
  metals: ({ metalsTest: test }, { body, presentation }) => {
    if (!test) {
      return null
    }

    // The metal they wear goes left; "both" shows gold and silver, both worn.
    const metals: readonly ['gold' | 'silver', 'gold' | 'silver'] =
      test.best === 'silver' ? ['silver', 'gold'] : ['gold', 'silver']

    return {
      layout: 'pair',
      panels: metals.map(
        (metal): BoardPanel => ({
          ...METALS[metal],
          verdict: test.best === 'both' || test.best === metal ? 'wear' : 'avoid',
        }),
      ),
      prompt: buildMetalsBoardPrompt(metals, body?.presentation ?? presentation ?? 'unisex'),
      refs: 'portrait',
      size: '1536x1024',
    }
  },
  face: ({ faceTest: test }) =>
    test?.panels.length === 4
      ? faceGrid(
          swatchPanels(test.panels),
          test.kind === 'shirts' ? buildShirtsBoardPrompt(test.panels) : buildLipsBoardPrompt(test.panels),
        )
      : null,
  // Their current color (or facial hair) first, then the three to compare.
  hair: ({ hairTest: test }) =>
    test?.panels.length === 3
      ? test.kind === 'beard'
        ? faceGrid(
            [
              { label: test.current, verdict: 'current', hex: null },
              ...swatchPanels(test.panels).map((panel) => ({ ...panel, hex: null })),
            ],
            buildBeardBoardPrompt(test.current, test.panels.map((panel) => panel.name)),
          )
        : faceGrid(
            [{ label: test.current, verdict: 'current', hex: null }, ...swatchPanels(test.panels)],
            buildHairBoardPrompt(test.current, test.panels),
          )
      : null,
  palette: ({ paletteLooks: looks, seasonLean }, { colorAnalysis }) =>
    looks?.length === 4
      ? bodyGrid(
          looks.map((look) => ({ label: look.name, verdict: null, hex: null })),
          buildPaletteBoardPrompt(looks.map((look) => look.outfit), colorAnalysis?.season ?? seasonLean),
        )
      : null,
}

const styleBoards: Record<(typeof STYLE_BOARDS)[number], (profile: StyleProfile, source: BoardSource) => BoardSpec | null> = {
  silhouettes: ({ silhouetteTest: test }, { colorAnalysis }) =>
    test?.panels.length === 4
      ? bodyGrid(
          test.panels.map((panel) => ({ label: panel.name, verdict: panel.verdict, hex: null })),
          buildSilhouettesBoardPrompt(
            test.panels.map((panel) => panel.garment),
            midTone(colorAnalysis?.neutrals ?? []),
          ),
        )
      : null,
  necklines: ({ necklineTest: test }, { colorAnalysis }) =>
    test?.panels.length === 4
      ? faceGrid(
          test.panels.map((panel) => ({ label: panel.name, verdict: panel.verdict, hex: null })),
          buildNecklinesBoardPrompt(
            test.panels.map((panel) => panel.name),
            midTone(colorAnalysis?.bestColors ?? []),
          ),
        )
      : null,
  // A flat-lay of the capsule wardrobe: clothes only, drawn from nothing.
  capsule: ({ capsule }) =>
    capsule.length > 0
      ? { layout: 'single', panels: [], prompt: buildCapsuleBoardPrompt(capsule), refs: 'none', size: '1536x1024' }
      : null,
}

function collect<K extends BoardKind>(kinds: readonly K[], build: (kind: K) => BoardSpec | null) {
  const specs: Partial<Record<BoardKind, BoardSpec>> = {}

  for (const kind of kinds) {
    const spec = build(kind)

    if (spec) {
      specs[kind] = spec
    }
  }

  return specs
}

export function buildColorBoards(report: ColorReport, source: BoardSource) {
  return collect(COLOR_BOARDS, (kind) => colorBoards[kind](report, source))
}

export function buildStyleBoards(profile: StyleProfile, source: BoardSource) {
  return collect(STYLE_BOARDS, (kind) => styleBoards[kind](profile, source))
}

// The stored images of these boards, to remove along with them.
export function boardKeys(boards: AvatarDocument['reportBoards'], kinds: readonly BoardKind[] = BOARD_KINDS) {
  return kinds.map((kind) => boards?.[kind]?.key).filter((key): key is string => Boolean(key))
}

export function unsetBoards(kinds: readonly BoardKind[]) {
  return Object.fromEntries(kinds.map((kind) => [`reportBoards.${kind}`, ''])) as Record<string, ''>
}

// Puts a new report's boards in place as processing, in the same update as
// the report itself (`set`), and removes the images of the boards they
// replace. Those come from the document as it was right before the update,
// so a board that finished in the meantime isn't left behind.
export async function writeBoards(
  app: FastifyInstance,
  avatarId: ObjectId,
  kinds: readonly BoardKind[],
  specs: Partial<Record<BoardKind, BoardSpec>>,
  set: Record<string, unknown>,
) {
  const updatedAt = new Date()
  const boards: Record<string, ReportBoard> = {}

  for (const kind of kinds) {
    const spec = specs[kind]

    if (spec) {
      boards[`reportBoards.${kind}`] = { ...spec, status: 'processing', key: null, updatedAt }
    }
  }

  const missing = kinds.filter((kind) => !specs[kind])

  // A new selfie leaves reportBoards null, and null can't take fields.
  await app.collections.avatars.updateOne({ _id: avatarId, reportBoards: null }, { $set: { reportBoards: {} } })

  const previous = await app.collections.avatars.findOneAndUpdate(
    { _id: avatarId },
    { $set: { ...set, ...boards }, ...(missing.length > 0 ? { $unset: unsetBoards(missing) } : {}) },
    { returnDocument: 'before' },
  )

  await Promise.all(boardKeys(previous?.reportBoards, kinds).map((key) => storage.remove(key).catch(() => undefined)))

  return app.collections.avatars.findOne({ _id: avatarId })
}

// 'hairLine' tells portrait boards which hair wins when the avatar wears a
// haircut from the Hair studio (a close-up of it is the last portrait image).
type References = Record<'portrait' | 'body', ImageInput[]> & { hairLine?: string }

// The avatar for every board but the capsule, plus the selfie as a close-up
// of the face for the portraits. Before the avatar (colors first) the
// portraits come from the selfie alone and full-body boards can't render.
async function readReferences(avatar: AvatarDocument, boards: ReportBoard[]): Promise<References> {
  const references: References = { portrait: [], body: [] }

  if (boards.every((board) => board.refs === 'none')) {
    return references
  }

  if (!avatar.avatarKey) {
    if (boards.some((board) => board.refs === 'portrait')) {
      references.portrait = [{ data: await storage.read(avatar.selfieKey), filename: 'selfie.jpg', contentType: 'image/jpeg' }]
    }

    return references
  }

  references.body = [{ data: await storage.read(avatar.avatarKey), filename: 'avatar.webp', contentType: 'image/webp' }]

  if (boards.some((board) => board.refs === 'portrait')) {
    references.portrait = [
      ...references.body,
      { data: await storage.read(avatar.selfieKey), filename: 'face.jpg', contentType: 'image/jpeg' },
    ]

    const hair = await hairReference(avatar, references.portrait.length + 1)

    if (hair) {
      references.portrait.push(hair.image)
      references.hairLine = hair.line
    }
  }

  return references
}

// Only the run that started a board can finish it: starting it again, or
// clearing the report (a new selfie or body), changes or removes updatedAt.
async function finishBoard(
  app: FastifyInstance,
  avatarId: ObjectId,
  kind: BoardKind,
  startedAt: Date,
  update: Pick<ReportBoard, 'status' | 'key'>,
) {
  const path = `reportBoards.${kind}`

  return app.collections.avatars.updateOne(
    { _id: avatarId, [`${path}.updatedAt`]: startedAt },
    { $set: { [`${path}.status`]: update.status, [`${path}.key`]: update.key, [`${path}.updatedAt`]: new Date() } },
  )
}

async function renderBoard(
  app: FastifyInstance,
  avatar: AvatarDocument,
  kind: BoardKind,
  board: ReportBoard,
  references: References,
) {
  try {
    if (board.refs !== 'none' && references[board.refs].length === 0) {
      throw new Error('The avatar has no image.')
    }

    const png =
      board.refs === 'none'
        ? await generateImage({ prompt: board.prompt, size: board.size })
        : await generateImageFromReferences({
            images: references[board.refs],
            prompt:
              board.refs === 'portrait' && !avatar.avatarKey
                ? selfieOnly(board.prompt)
                : board.refs === 'portrait' && references.hairLine
                  ? `${board.prompt} ${references.hairLine}`
                  : board.prompt,
            size: board.size,
          })
    const key = `users/${avatar.userId.toString()}/board-${kind}-${Date.now()}.webp`

    await storage.put(key, await toStoredWebp(png), 'image/webp')

    const result = await finishBoard(app, avatar._id, kind, board.updatedAt, { status: 'ready', key })

    // Started again or cleared while it rendered.
    if (result.matchedCount === 0) {
      await storage.remove(key).catch(() => undefined)
    }
  } catch (error) {
    app.log.error({ avatarId: avatar._id.toString(), board: kind, err: errorMessage(error) }, 'Report board failed')
    await finishBoard(app, avatar._id, kind, board.updatedAt, { status: 'failed', key: null })
  }
}

// Renders the boards of these kinds that are processing, a few at a time
// (~30 s each).
export async function runBoards(app: FastifyInstance, avatarId: ObjectId, kinds: readonly BoardKind[]) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })
  const queue = kinds.flatMap((kind) => {
    const board = avatar?.reportBoards?.[kind]

    return board?.status === 'processing' ? [{ kind, board }] : []
  })

  if (!avatar || queue.length === 0) {
    return
  }

  let references: References

  try {
    references = await readReferences(avatar, queue.map((item) => item.board))
  } catch (error) {
    app.log.error({ avatarId: avatarId.toString(), err: errorMessage(error) }, 'Report boards failed')
    await Promise.all(
      queue.map((item) => finishBoard(app, avatarId, item.kind, item.board.updatedAt, { status: 'failed', key: null })),
    )
    return
  }

  await Promise.all(
    Array.from({ length: BOARD_CONCURRENCY }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await renderBoard(app, avatar, item.kind, item.board, references)
      }
    }),
  )
}

export function startBoards(app: FastifyInstance, avatarId: ObjectId, kinds: readonly BoardKind[]) {
  void runBoards(app, avatarId, kinds).catch((error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Report boards crashed')
  })
}
