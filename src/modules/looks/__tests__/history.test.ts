import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import type { AvatarDocument, LookDocument, LookItem } from '../../../types/mongo.js'
import { REMIX_HISTORY_DEPTH, remixHistory } from '../history.js'
import { buildLookRenderPrompt, buildRemixRequest } from '../prompts.js'

type Look = Pick<LookDocument, 'plan' | 'occasion' | 'feedback' | 'remix' | 'remixOf'> & { _id: ObjectId }

const WEDDING = 'Wedding guest, invitation says cocktail attire, evening reception'

function item(slot: LookItem['slot'], name: string, color: string, colorHex: string): LookItem {
  return { slot, name, color, colorHex, material: 'Crepe', fit: 'relaxed' }
}

function look(title: string, note: string | null, parent: Look | null, extra: Partial<Look> = {}): Look {
  return {
    _id: new ObjectId(),
    occasion: { text: WEDDING, dressCode: 'Cocktail attire', summary: '' },
    plan: {
      title,
      vibe: 'Elegant',
      summary: `${title}.`,
      whyItWorks: '',
      items: [item('dress', `${title} dress`, 'Slate blue', '#6C7FA3'), item('shoes', 'Slingback pumps', 'Silver', '#C0C0C0')],
      stylingTips: [],
    },
    feedback: note === null ? null : { rating: 'down', aspects: [], pieces: [], note, at: new Date() },
    remix: parent ? { change: 'fix', detail: null } : null,
    remixOf: parent?._id ?? null,
    ...extra,
  }
}

function finder(looks: Look[]) {
  const byId = new Map(looks.map((entry) => [entry._id.toString(), entry]))
  return async (id: ObjectId) => byId.get(id.toString()) ?? null
}

describe('remixHistory', () => {
  it('collects every earlier look of a fix chain, oldest first, with what they said', async () => {
    const first = look('Berry column', 'Floor length, no slit', null)
    const second = look('Slate jumpsuit', 'I want a dress', first)
    const third = look('Velvet dress', 'Full length no mauve no jacket', second)

    const history = await remixHistory(third, finder([first, second, third]))

    assert.deepEqual(
      history.map((entry) => entry.feedback?.note),
      ['Floor length, no slit', 'I want a dress'],
    )
  })

  it('keeps what they asked for in a custom remix', async () => {
    const first = look('Berry column', null, null)
    const second = look('Longer column', 'Not this color', first, { remix: { change: 'custom', detail: 'Make it floor length' } })
    const third = look('Third', null, second)

    const history = await remixHistory(third, finder([first, second, third]))

    assert.equal(history[1]?.asked, 'Make it floor length')
    assert.equal(history[0]?.asked, null)
  })

  it('stops at a remix for another occasion', async () => {
    const first = look('Office look', 'Too stiff', null, {
      occasion: { text: 'A day at the office', dressCode: 'Business casual', summary: '' },
    })
    const second = look('Wedding look', null, first, { remix: { change: 'occasion', detail: WEDDING } })
    const third = look('Wedding fix', null, second)

    const history = await remixHistory(third, finder([first, second, third]))

    assert.deepEqual(
      history.map((entry) => entry.plan.title),
      ['Wedding look'],
    )
  })

  it('reads at most a fixed number of looks back', async () => {
    const chain: Look[] = []

    for (let index = 0; index < REMIX_HISTORY_DEPTH + 4; index += 1) {
      chain.push(look(`Look ${index}`, `note ${index}`, chain.at(-1) ?? null))
    }

    const history = await remixHistory(chain.at(-1)!, finder(chain))

    assert.equal(history.length, REMIX_HISTORY_DEPTH)
    assert.equal(history.at(-1)?.plan.title, `Look ${chain.length - 2}`)
  })
})

const avatar = {
  body: { heightCm: 165, weightKg: 62, build: 'curvy', presentation: 'womenswear' },
  colorAnalysis: null,
} as unknown as AvatarDocument

describe('buildRemixRequest for a fix', () => {
  it('carries the brief notes and every earlier word of the chain', () => {
    const first = look('Berry column', 'Floor length, no slit', null)
    const second = look('Velvet dress', 'Full length no mauve no jacket', first)
    const request = buildRemixRequest({
      avatar,
      base: { ...second, occasion: { ...second.occasion, notes: 'No heels', asks: ['Wedding guest', 'No heels'] } },
      change: 'fix',
      detail: 'Thumbs down (no reason given). In their words: "Full length no mauve no jacket"',
      history: [{ plan: first.plan, feedback: first.feedback ?? null }],
    })

    assert.match(request, /Their notes: "No heels"/)
    assert.match(request, /What they asked for: Wedding guest; No heels/)
    assert.match(request, /"Floor length, no slit"/)
    assert.match(request, /"Full length no mauve no jacket"/)
    assert.match(request, /hard rules/i)
    assert.doesNotMatch(request, /no dress at all/)
  })
})

describe('buildLookRenderPrompt', () => {
  it('gives the image model the exact color of every garment', () => {
    const prompt = buildLookRenderPrompt(look('Terracotta', null, null).plan, WEDDING)

    assert.match(prompt, /in exactly #6C7FA3/)
    assert.match(prompt, /in exactly #C0C0C0/)
    assert.match(prompt, /true saturation/)
    assert.doesNotMatch(prompt, /soft even lighting|warm-grey/)
  })
})
