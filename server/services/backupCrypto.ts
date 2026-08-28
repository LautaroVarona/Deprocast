import crypto from 'node:crypto'
import fs from 'node:fs'
import { readEnv } from '../config.js'

const MAGIC = Buffer.from('DEPROENC1', 'utf8')

export function backupPassphrase(): string {
  return readEnv('BACKUP_PASSPHRASE')
}

export function encryptBackupPayload(plain: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(passphrase, salt, 32)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  const hmac = crypto.createHmac('sha256', key).update(ciphertext).digest()
  return Buffer.concat([MAGIC, salt, iv, tag, hmac, ciphertext])
}

export function decryptBackupPayload(blob: Buffer, passphrase: string): Buffer {
  if (blob.length < MAGIC.length + 16 + 12 + 16 + 32) {
    throw new Error('Backup cifrado truncado')
  }
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('No es un backup cifrado Deprocast')
  }
  let o = MAGIC.length
  const salt = blob.subarray(o, o + 16)
  o += 16
  const iv = blob.subarray(o, o + 12)
  o += 12
  const tag = blob.subarray(o, o + 16)
  o += 16
  const hmac = blob.subarray(o, o + 32)
  o += 32
  const ciphertext = blob.subarray(o)
  const key = crypto.scryptSync(passphrase, salt, 32)
  const expect = crypto.createHmac('sha256', key).update(ciphertext).digest()
  if (!crypto.timingSafeEqual(hmac, expect)) {
    throw new Error('Firma del backup inválida')
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function maybeEncryptDump(json: string): {
  body: Buffer
  encrypted: boolean
  name: string
} {
  const pass = backupPassphrase()
  const plain = Buffer.from(json, 'utf8')
  if (!pass) return { body: plain, encrypted: false, name: 'dump.json' }
  return {
    body: encryptBackupPayload(plain, pass),
    encrypted: true,
    name: 'dump.json.enc',
  }
}

export function maybeDecryptDumpFile(abs: string): string {
  const buf = fs.readFileSync(abs)
  if (buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    const pass = backupPassphrase()
    if (!pass) {
      throw new Error('Backup cifrado: definí BACKUP_PASSPHRASE para restaurar')
    }
    return decryptBackupPayload(buf, pass).toString('utf8')
  }
  return buf.toString('utf8')
}
