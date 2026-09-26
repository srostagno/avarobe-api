// End-to-end check of password + passkey auth against a running dev API, with a
// software authenticator (P-256, "none" attestation) standing in for a phone.
import crypto from 'node:crypto'

import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'

const API = process.env.AUTH_E2E_API ?? 'http://localhost:4100/api/v1'
const ORIGIN = process.env.AUTH_E2E_ORIGIN ?? 'http://localhost:3100'
const RP_ID = process.env.AUTH_E2E_RP_ID ?? 'localhost'
const email = `e2e+${Date.now()}@avarobe.test`
const results = []

function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function jar() {
  const cookies = new Map()

  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    store(response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';')
        const index = pair.indexOf('=')
        const name = pair.slice(0, index)
        const value = pair.slice(index + 1)

        if (value) cookies.set(name, value)
        else cookies.delete(name)
      }
    },
    clear: () => cookies.clear(),
  }
}

async function call(session, path, body, method = 'POST') {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Origin: ORIGIN,
      Cookie: session.header(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  session.store(response)
  const data = await response.json().catch(() => ({}))

  return { status: response.status, data }
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest()
const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

class SoftAuthenticator {
  constructor() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = publicKey.export({ format: 'jwk' })
    this.privateKey = privateKey
    this.credentialId = crypto.randomBytes(16)
    this.cosePublicKey = isoCBOR.encode(
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    )
    this.counter = 0
  }

  register(options) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: ORIGIN, crossOrigin: false }),
    )
    const idLength = Buffer.alloc(2)
    idLength.writeUInt16BE(this.credentialId.length)
    // UP | UV | BE | BS | AT: a synced, platform passkey.
    const authData = Buffer.concat([
      sha256(RP_ID),
      Buffer.from([0x01 | 0x04 | 0x08 | 0x10 | 0x40]),
      u32(this.counter),
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      Buffer.from(this.cosePublicKey),
    ])
    const attestationObject = isoCBOR.encode(
      new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    )
    const id = isoBase64URL.fromBuffer(this.credentialId)

    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  authenticate(options, { counter } = {}) {
    this.counter = counter ?? this.counter + 1
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: ORIGIN, crossOrigin: false }),
    )
    const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x01 | 0x04 | 0x08 | 0x10]), u32(this.counter)])
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey)
    const id = isoBase64URL.fromBuffer(this.credentialId)

    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }
}

const a = jar()
const b = jar()

// Password
let r = await call(a, '/auth/register', { email, password: 'short', firstName: 'E2E' })
check('weak password rejected', r.status === 400, r.data.message)
r = await call(a, '/auth/register', { email, password: 'correct horse battery', firstName: 'E2E' })
check('register with password', r.status === 201 && r.data.user?.hasPassword === true, `status ${r.status}`)
r = await call(a, '/auth/me', undefined, 'GET')
check('session after register', r.status === 200 && r.data.user?.email === email)
r = await call(b, '/auth/register', { email, password: 'another long password' })
check('duplicate register refused', r.status === 409, r.data.message)
r = await call(b, '/auth/login', { email, password: 'wrong password!!' })
check('wrong password refused', r.status === 401, r.data.message)
r = await call(b, '/auth/login', { email: 'nobody@avarobe.test', password: 'whatever12345' })
check('unknown email gives same error', r.status === 401 && r.data.message === 'Email or password is incorrect.')
r = await call(b, '/auth/login', { email, password: 'correct horse battery' })
check('login with password (second session)', r.status === 200)
r = await call(a, '/auth/password', { currentPassword: 'nope nope nope', newPassword: 'new long password 1' })
check('change password needs current one', r.status === 400, r.data.message)
r = await call(a, '/auth/password', { currentPassword: 'correct horse battery', newPassword: 'new long password 1' })
check('change password', r.status === 200)
r = await call(b, '/auth/refresh', {})
check('other session signed out after change', r.status === 401)
b.clear()
r = await call(b, '/auth/login', { email, password: 'new long password 1' })
check('login with new password', r.status === 200)

// Passkeys
const device = new SoftAuthenticator()
r = await call(a, '/auth/passkeys/register/options', {})
check('passkey registration options', r.status === 200 && r.data.options?.rp?.id === RP_ID, `rp ${r.data.options?.rp?.id}`)
const registration = device.register(r.data.options)
r = await call(a, '/auth/passkeys/register/verify', { challengeId: r.data.challengeId, response: registration })
check('passkey registered', r.status === 201 && r.data.passkey?.backedUp === true, `${r.status} ${r.data.message ?? r.data.passkey?.name}`)
r = await call(a, '/auth/passkeys/register/verify', { challengeId: 'x'.repeat(32), response: registration })
check('unknown challenge refused', r.status === 400)

const guest = jar()
r = await call(guest, '/auth/passkeys/login/options', {})
const loginChallenge = r.data.challengeId
const assertion = device.authenticate(r.data.options)
r = await call(guest, '/auth/passkeys/login/verify', { challengeId: loginChallenge, response: assertion })
check('sign in with passkey', r.status === 200 && r.data.user?.email === email, r.data.message)
r = await call(guest, '/auth/me', undefined, 'GET')
check('passkey session works', r.status === 200)
r = await call(jar(), '/auth/passkeys/login/verify', { challengeId: loginChallenge, response: assertion })
check('replayed assertion refused', r.status === 400 || r.status === 401, `status ${r.status}`)

r = await call(jar(), '/auth/passkeys/login/options', {})
r = await call(jar(), '/auth/passkeys/login/verify', {
  challengeId: r.data.challengeId,
  response: device.authenticate(r.data.options, { counter: 1 }),
})
check('cloned authenticator (counter went backwards) refused', r.status === 401, `status ${r.status}`)

const stranger = new SoftAuthenticator()
r = await call(jar(), '/auth/passkeys/login/options', {})
r = await call(jar(), '/auth/passkeys/login/verify', { challengeId: r.data.challengeId, response: stranger.authenticate(r.data.options) })
check('unknown passkey refused', r.status === 401, r.data.message)

r = await call(a, '/auth/passkeys', undefined, 'GET')
check('list passkeys', r.status === 200 && r.data.passkeys?.length === 1, r.data.passkeys?.[0]?.name)
const passkeyId = r.data.passkeys?.[0]?.id

// Sign-in link on an unverified account clears credentials set before it.
r = await call(jar(), '/auth/start', { email })
const token = decodeURIComponent(r.data.devLoginUrl.split('token=')[1])
const linkSession = jar()
r = await call(linkSession, '/auth/consume', { token })
check('link sign-in resets pre-verification credentials', r.status === 200 && r.data.credentialsReset === true && r.data.user?.hasPassword === false)
r = await call(linkSession, '/auth/passkeys', undefined, 'GET')
check('passkeys removed', r.status === 200 && r.data.passkeys?.length === 0)
r = await call(a, '/auth/refresh', {})
check('older sessions revoked', r.status === 401)

// Verified account keeps new credentials on later link sign-ins.
r = await call(linkSession, '/auth/password', { newPassword: 'fresh long password' })
check('set password without current one (none set)', r.status === 200 && r.data.user?.hasPassword === true)
r = await call(jar(), '/auth/start', { email })
r = await call(jar(), '/auth/consume', { token: decodeURIComponent(r.data.devLoginUrl.split('token=')[1]) })
check('verified account keeps its password', r.status === 200 && r.data.credentialsReset === false && r.data.user?.hasPassword === true)

r = await call(linkSession, `/auth/passkeys/${passkeyId}`, undefined, 'DELETE')
check('deleting a removed passkey gives 404', r.status === 404)

r = await call(linkSession, '/me', undefined, 'DELETE')
check('cleanup: test account deleted', r.status === 200)

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
