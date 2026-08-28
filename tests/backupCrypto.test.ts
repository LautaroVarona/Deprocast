import { describe, expect, it } from 'vitest'
import { encryptBackupPayload, decryptBackupPayload } from '../server/services/backupCrypto.ts'

describe('backupCrypto', () => {
  it('roundtrip y firma', () => {
    const plain = Buffer.from('{"format":"deprocast-backup"}')
    const blob = encryptBackupPayload(plain, 'frase-de-prueba')
    expect(decryptBackupPayload(blob, 'frase-de-prueba').toString()).toBe(
      plain.toString(),
    )
    expect(() => decryptBackupPayload(blob, 'otra')).toThrow()
  })
})
