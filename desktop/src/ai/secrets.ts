/*
 * --- desktop-exe --- The cloud API key at rest: encrypted with Electron's safeStorage (DPAPI on Windows, the keychain on
 * macOS, the secret service on Linux) and stored as base64 in the app's preferences. Without a working encryption backend
 * the key is not stored at all – never in plain text – and the app says so. It is never sent to the page.
 */

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

export class SecretBox {
  constructor(private readonly storage: SafeStorageLike) {}

  get available(): boolean {
    try {
      return this.storage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  seal(secret: string): string {
    if (!this.available) throw new Error("Secure storage is not available on this system: the key was not saved");
    return this.storage.encryptString(secret).toString("base64");
  }

  open(sealed: string | undefined | null): string | null {
    if (!sealed || !this.available) return null;
    try {
      return this.storage.decryptString(Buffer.from(sealed, "base64"));
    } catch {
      return null;
    }
  }
}
