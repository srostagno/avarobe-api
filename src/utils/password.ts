import argon2 from 'argon2'

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

// Length over composition rules (NIST SP 800-63B): long passphrases are
// stronger and easier to remember than forced symbols.
export function passwordProblem(password: string, email: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`
  }

  if (password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "Your password can't be your email."
  }

  return null
}

export async function hashPassword(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })
}

export async function verifyPassword(password: string, passwordHash: string) {
  try {
    return await argon2.verify(passwordHash, password)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | null = null

// Verifies against a throwaway hash so a login for an unknown email takes as
// long as one for a real account, which keeps emails from being probed.
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword('not-a-real-password-for-timing')
  await verifyPassword(password, await dummyHash)
}
