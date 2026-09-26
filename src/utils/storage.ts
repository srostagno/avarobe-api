import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { env } from '../config/env.js'
import { hmacSign, hmacVerify } from './tokens.js'

// Photos are private. The local driver (development) serves files through a
// signed API route; the S3 driver uses presigned GET URLs. Keys look like
// `users/<userId>/<file>` so deleting an account can sweep one prefix.
export type Storage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  read(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
  signedUrl(key: string): Promise<string>
}

const KEY_PATTERN = /^users\/[a-f0-9]{24}\/[A-Za-z0-9._-]+$/

export function isValidStorageKey(key: string) {
  return KEY_PATTERN.test(key)
}

function mediaSigningSecret() {
  return `media:${env.JWT_ACCESS_SECRET}`
}

export function verifyLocalMediaSignature(key: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return false
  }

  return hmacVerify(mediaSigningSecret(), `${key}:${exp}`, sig)
}

export function localPathFor(key: string) {
  if (!isValidStorageKey(key)) {
    throw new Error(`Invalid storage key: ${key}`)
  }

  return path.resolve(env.STORAGE_LOCAL_DIR, key)
}

function createLocalStorage(): Storage {
  return {
    async put(key, body) {
      const filePath = localPathFor(key)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, body)
    },
    async read(key) {
      return readFile(localPathFor(key))
    },
    async remove(key) {
      await rm(localPathFor(key), { force: true })
    },
    async signedUrl(key) {
      const exp = Math.floor(Date.now() / 1000) + env.MEDIA_URL_TTL_SECONDS
      const sig = hmacSign(mediaSigningSecret(), `${key}:${exp}`)

      return `${env.API_PUBLIC_URL}/api/v1/media/${key}?exp=${exp}&sig=${sig}`
    },
  }
}

function createS3Storage(): Storage {
  const bucket = env.S3_BUCKET as string
  const client = new S3Client({ region: env.S3_REGION })
  const objectKey = (key: string) => `${env.S3_PREFIX}${key}`

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(key),
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      )
    },
    async read(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }),
      )

      if (!result.Body) {
        throw new Error(`Empty S3 object: ${key}`)
      }

      return Buffer.from(await result.Body.transformToByteArray())
    },
    async remove(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) }),
      )
    },
    async signedUrl(key) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }),
        { expiresIn: env.MEDIA_URL_TTL_SECONDS },
      )
    },
  }
}

export const storage: Storage =
  env.STORAGE_DRIVER === 's3' ? createS3Storage() : createLocalStorage()

export async function signedUrlOrNull(key: string | null) {
  return key ? storage.signedUrl(key) : null
}
