import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import type { ShopMatch } from '../../../types/mongo.js'
import { isLocalStore, isShoppable, isStore, marketById } from '../markets.js'
import { cleanPrice } from '../serpapi.js'

// The store search's first eight results for one piece (a coral scoop-neck
// silk tee on a womenswear avatar) in four markets with "Only stores in" on,
// as the app returned them on Oct 11 2026 (the Pro tour's capture, local API).
type Row = { source: string; domain: string; link: string; title: string; price: string | null }

const capture = JSON.parse(readFileSync(new URL('./capture-oct-2026.json', import.meta.url), 'utf8')) as Record<'br' | 'mx' | 'co' | 'us', Row[]>

const match = (row: Partial<Row> & { title: string }): ShopMatch => ({
  title: row.title,
  link: row.link ?? `https://${row.domain ?? 'store.example'}/p/1`,
  domain: row.domain ?? 'store.example',
  source: row.source ?? row.domain ?? 'store.example',
  sourceIcon: null,
  thumbnail: null,
  price: row.price ?? null,
  extractedPrice: null,
  currency: null,
  inStock: null,
})

// What the app shows first, in its order.
function top(market: 'br' | 'mx' | 'co' | 'us', presentation: string | null = 'womenswear') {
  return capture[market]
    .map(match)
    .filter((item) => isStore(item) && isShoppable(item, presentation) && isLocalStore(item, marketById(market)))
    .slice(0, 3)
    .map((item) => item.source)
}

describe('store search results', () => {
  it('leaves out second-hand sites, listing and sale pages and the wrong department', () => {
    assert.deepEqual(top('br'), ['Dafiti', 'Shopee Brasil', 'Riachuelo'])
    assert.deepEqual(top('mx'), ['Amazon.com.mx', 'Mercado Libre', 'Amazon.com.mx'])
    assert.deepEqual(top('co'), ['SHEIN Colombia', 'Mercado Libre Colombia', 'SHEIN Colombia'])
    assert.deepEqual(top('us'), ['Gap', 'Macy’s', 'Duluth Trading Company'])
  })

  it('names why each dropped row goes', () => {
    const br = capture.br.map(match)
    const dropped = br.filter((item) => !isShoppable(item, 'womenswear')).map((item) => item.domain)
    // A kids' blouse, a kids' sale page, a Mercado Livre search list, a used shirt.
    assert.deepEqual(dropped, ['dafiti.com.br', 'hering.com.br', 'lista.mercadolivre.com.br', 'enjoei.com.br'])

    const co = capture.co.map(match).filter((item) => !isShoppable(item, 'womenswear')).map((item) => item.title)
    assert.ok(co.every((title) => /www\.tennis\.com\.co|Hombre/.test(title)))
  })

  it('keeps the other department for no one in particular, and drops it per avatar', () => {
    const mens = match({ title: 'Pack De 3 Camisetas para Hombre Calvin Klein' })
    const womens = match({ title: "Style & Co Women's Cotton Scoop-Neck Top" })

    assert.equal(isShoppable(mens, 'womenswear'), false)
    assert.equal(isShoppable(mens, 'menswear'), true)
    assert.equal(isShoppable(mens, null), true)
    assert.equal(isShoppable(womens, 'womenswear'), true)
    assert.equal(isShoppable(womens, 'menswear'), false)
    // "men's" inside "women's" is not men's.
    assert.equal(isShoppable(match({ title: "Women's AKHG Renew Bamboo Short Sleeve Tee" }), 'womenswear'), true)
    // Children's things never fit an adult's avatar.
    assert.equal(isShoppable(match({ title: 'Camiseta Niña Algodón' }), null), false)
    assert.equal(isShoppable(match({ title: 'Blusa básica', link: 'https://loja.example/kids/blusa' }), null), false)
  })

  it('takes the "*" off prices', () => {
    assert.equal(cleanPrice('R$ 36*'), 'R$ 36')
    assert.equal(cleanPrice('38.935 COP*'), '38.935 COP')
    assert.equal(cleanPrice('$20'), '$20')
    assert.equal(cleanPrice(' * '), null)
    assert.equal(cleanPrice(null), null)
  })
})
