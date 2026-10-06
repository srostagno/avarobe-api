import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { describe, it } from 'node:test'

import { editsFor } from '../edit-routes.js'
import { EDITS, UPCOMING_EDITS } from '../edits.js'
import { ICON_LOOKS } from '../icons.js'

const looks = EDITS.flatMap((edit) => edit.looks)

describe('Edits', () => {
  it('give every look a unique id across the whole catalog, so try-on finds the right one', () => {
    const ids = [...ICON_LOOKS, ...looks].map((look) => look.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('describe every look piece by piece, with real colors', () => {
    for (const look of looks) {
      assert.ok(look.items.length >= 3, `${look.id} has too few pieces`)
      for (const item of look.items) {
        assert.match(item.colorHex, /^#[0-9A-F]{6}$/i, `${look.id}: ${item.name}`)
      }
    }
  })

  it('ship a try-on reference image for every look', () => {
    for (const look of looks) {
      assert.ok(existsSync(new URL(`../../../../assets/icon-looks/${look.id}.jpg`, import.meta.url)), `${look.id}.jpg missing`)
    }
  })

  it('list the dropped Edits newest first with the icons last, mark the new ones, and announce the next drop', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    const { edits, next } = editsFor('womenswear', now)
    assert.deepEqual(edits.map((edit) => edit.id), ['halloween-2026', 'fall-2026', 'icons'])
    assert.equal(edits[0]!.isNew, true)
    assert.equal(edits.at(-1)!.isNew, false)
    assert.ok(edits[0]!.looks.every((look) => look.presentation === 'womenswear'))
    assert.equal(edits[0]!.looks.length, 20)
    assert.equal('scene' in edits[0]!.looks[0]!, false)
    assert.equal(next?.name, UPCOMING_EDITS[0]!.name)

    // A week later they're no longer new.
    assert.equal(editsFor('womenswear', new Date('2026-10-20T12:00:00Z')).edits[0]!.isNew, false)
  })

  it('drop a new Edit at least every week, as the app promises', () => {
    const dates = [...EDITS.map((edit) => edit.droppedAt), ...UPCOMING_EDITS.map((edit) => edit.at)].sort()
    for (let index = 1; index < dates.length; index++) {
      const gap = (Date.parse(dates[index]!) - Date.parse(dates[index - 1]!)) / (24 * 60 * 60 * 1000)
      assert.ok(gap <= 7, `nothing drops between ${dates[index - 1]} and ${dates[index]}`)
    }
  })

  it('give menswear its own looks', () => {
    const { edits } = editsFor('menswear', new Date('2026-10-08T12:00:00Z'))
    assert.ok(edits.every((edit) => edit.looks.every((look) => look.presentation === 'menswear')))
    assert.ok(edits[0]!.looks.length >= 6)
  })
})
