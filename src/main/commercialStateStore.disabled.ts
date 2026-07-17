export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(plaintext: string): Buffer
  decryptString(ciphertext: Buffer): string
}
