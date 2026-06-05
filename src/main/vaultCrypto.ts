import { createCipheriv, createDecipheriv, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'crypto'

// scrypt parameters: N=2^17 requires roughly 128 MB; maxmem must exceed Node's 32 MB default.
export const SCRYPT_N = 131072
export const SCRYPT_R = 8
export const SCRYPT_P = 1
export const KEY_LENGTH = 32
export const SCRYPT_MAXMEM = 256 * 1024 * 1024

export interface ScryptParams {
  N: number
  r: number
  p: number
  keylen?: number
}

export function randomVaultKey(): Buffer {
  return randomBytes(KEY_LENGTH)
}

export function randomSalt(): Buffer {
  return randomBytes(32)
}

export function scrypt(password: string, salt: Buffer, params: ScryptParams = currentScryptParams()): Promise<Buffer> {
  const keylen = params.keylen ?? KEY_LENGTH
  return new Promise((resolve, reject) =>
    nodeScrypt(
      password,
      salt,
      keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM },
      (error, key) => error ? reject(error) : resolve(key),
    )
  )
}

export function currentScryptParams(): Required<ScryptParams> {
  return { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keylen: KEY_LENGTH }
}

// AES-256-GCM: [12B IV][16B tag][...ciphertext]
export function seal(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

export function open(blob: Buffer, key: Buffer): Buffer {
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(12, 28)
  const body = blob.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

export function sameKey(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}
