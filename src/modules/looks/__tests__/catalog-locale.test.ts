import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CatalogTable } from '../../../i18n/catalog-types.js'
import { esCatalog } from '../../../i18n/catalog.es.js'
import { ptBrCatalog } from '../../../i18n/catalog.pt-BR.js'
import { withLocale } from '../../../utils/request-locale.js'
import { editsFor } from '../edit-routes.js'
import { EDITS, UPCOMING_EDITS } from '../edits.js'
import { ICON_LOOKS } from '../icons.js'

const NOW = new Date('2026-10-08T12:00:00Z')
const LOOKS = [...EDITS.flatMap((edit) => edit.looks), ...ICON_LOOKS]
const TABLES: [string, CatalogTable][] = [
  ['pt-BR', ptBrCatalog],
  ['es', esCatalog],
]

describe('Catalog in other languages', () => {
  it('serves the Edits in Brazilian Portuguese inside a pt-BR request', () => {
    const { edits, next } = withLocale('pt-BR', () => editsFor('womenswear', NOW))
    const halloween = edits.find((edit) => edit.id === 'halloween-2026')!

    assert.equal(halloween.name, 'Edit de Halloween')
    assert.equal(halloween.tagline, ptBrCatalog.edits['halloween-2026']!.tagline)
    assert.equal(edits.at(-1)!.name, 'Ícones')
    assert.equal(next?.name, ptBrCatalog.upcoming[UPCOMING_EDITS[0]!.name])

    const look = halloween.looks.find((item) => item.id === 'hw-couture-pumpkin')!
    const english = EDITS[0]!.looks.find((item) => item.id === 'hw-couture-pumpkin')!
    assert.equal(look.name, ptBrCatalog.looks['hw-couture-pumpkin']!.name)
    assert.equal(look.mood, 'Festa à fantasia')
    assert.equal(look.items[0]!.name, ptBrCatalog.pieces[english.items[0]!.name])
    // What the image model and the web key on stays as it is.
    assert.equal(look.items[0]!.colorHex, english.items[0]!.colorHex)
    assert.equal(look.items[0]!.slot, english.items[0]!.slot)
    assert.equal(look.image, '/icon-looks/hw-couture-pumpkin.webp')
  })

  it('serves them in Spanish inside an es request', () => {
    const { edits } = withLocale('es', () => editsFor('menswear', NOW))
    assert.equal(edits.find((edit) => edit.id === 'fall-2026')!.name, 'Edit de Otoño')
    assert.equal(edits.at(-1)!.name, 'Íconos')
  })

  it('keeps English without a locale, and leaves the catalog itself untouched', () => {
    const { edits, next } = editsFor('womenswear', NOW)
    assert.equal(edits[0]!.name, 'The Halloween Edit')
    assert.equal(edits.at(-1)!.name, 'Icons')
    assert.equal(next?.name, UPCOMING_EDITS[0]!.name)
    assert.equal(edits[0]!.looks[0]!.items[0]!.name, EDITS[0]!.looks[0]!.items[0]!.name)

    withLocale('pt-BR', () => editsFor('womenswear', NOW))
    assert.equal(EDITS[0]!.name, 'The Halloween Edit')
    assert.equal(EDITS[0]!.looks[0]!.items[0]!.name, 'Pumpkin ballgown')
  })

  for (const [locale, table] of TABLES) {
    it(`translates every Edit, look and piece in ${locale}`, () => {
      for (const id of [...EDITS.map((edit) => edit.id), 'icons']) {
        assert.ok(table.edits[id]?.name && table.edits[id]?.tagline, `edit ${id}`)
      }
      for (const { name } of UPCOMING_EDITS) {
        assert.ok(table.upcoming[name], `upcoming ${name}`)
      }
      for (const look of LOOKS) {
        const text = table.looks[look.id]
        assert.ok(text?.name && text.description && text.era && text.mood, `look ${look.id}`)
        for (const item of look.items) {
          for (const english of [item.name, item.color, item.material, item.fit]) {
            assert.ok(table.pieces[english], `${look.id}: "${english}"`)
          }
        }
      }
    })
  }
})
