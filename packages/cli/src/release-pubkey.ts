// SPDX-License-Identifier: Apache-2.0

import { createHash, createPublicKey, verify } from 'node:crypto';

/**
 * Pinned ed25519 public key for Valetto CLI release signatures.
 * Fingerprint (SHA-256 of the raw 32-byte key): sha256:f85d73645f98325d0b6fc20b9069f106c393322e148c400fcfa016d9bbc27ca5
 */
export const CLI_RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXNXJpFRHlCOivM2leVI09/VEwvXxgvxrT/s/No+8IZE=
-----END PUBLIC KEY-----
`;

export const CLI_RELEASE_PUBLIC_KEY_FINGERPRINT =
  'sha256:f85d73645f98325d0b6fc20b9069f106c393322e148c400fcfa016d9bbc27ca5';

export const CLI_VERSION_MARKER_RE = /^\/\/ valetto-cli-version: (\d+\.\d+\.\d+)\s*$/m;

export function cliReleasePublicKeyFingerprint(pem: string = CLI_RELEASE_PUBLIC_KEY_PEM): string {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  const raw = der.subarray(der.length - 32);
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}

export function parseCliScriptVersionFromBytes(bytes: Buffer | string): string | null {
  const text = typeof bytes === 'string' ? bytes : bytes.toString('utf8');
  const match = CLI_VERSION_MARKER_RE.exec(text);
  return match?.[1] ?? null;
}

/** Detached ed25519 signature, standard base64 of the 64-byte raw signature. */
export function decodeCliReleaseSignature(signature: string): Buffer | null {
  const trimmed = signature.trim();
  if (!trimmed) return null;
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length !== 64) return null;
  if (buf.toString('base64') !== trimmed.replace(/\s+/g, '')) {
    // Allow whitespace in the file; require a faithful 64-byte decode.
    const compact = trimmed.replace(/\s+/g, '');
    const again = Buffer.from(compact, 'base64');
    if (again.length !== 64) return null;
    return again;
  }
  return buf;
}

export function verifyCliReleaseSignature(
  bytes: Buffer,
  signature: string,
  publicKeyPem: string = CLI_RELEASE_PUBLIC_KEY_PEM,
): boolean {
  const sig = decodeCliReleaseSignature(signature);
  if (!sig) return false;
  try {
    return verify(null, bytes, createPublicKey(publicKeyPem), sig);
  } catch {
    return false;
  }
}
