import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { outfitGuideEmail } from '../../lifecycle/templates.js'

describe('the Outfit Formula Book email', () => {
  it('carries the download link and a receipt footer, not the account one', () => {
    const email = outfitGuideEmail({ email: 'buyer@example.com', firstName: 'Dana', downloadUrl: 'https://api.example.com/api/v1/guide/download/abc' })
    assert.equal(email.subject, 'Your Outfit Formula Book is here')
    assert.match(email.html, /guide\/download\/abc/)
    assert.match(email.text, /Download my guide \(PDF\): https:\/\/api\.example\.com/)
    assert.match(email.text, /you bought The Outfit Formula Book on avarobe\.com with buyer@example\.com/)
    assert.doesNotMatch(email.text, /created an Avarobe account/)
    assert.match(email.text, /Hi Dana,/)
    assert.match(email.text, /hello@avarobe\.com/)
    assert.doesNotMatch(email.text, /reads your colors/)
  })
})
