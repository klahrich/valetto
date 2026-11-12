// SPDX-License-Identifier: Apache-2.0

import { createHash, createPublicKey, verify } from 'node:crypto';

/**
 * Pinned ed25519 public key for Valetto CLI release signatures.
 * Fingerprint (SHA-256 of the raw 32-byte key): sha256:c53ce36602db71b41c10a2fbfe5752de322b9e1b7fb4c415121cbad5ec2ec016
 */
export const CLI_RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAyT/KED0i/yr2t2PdX8B7+8T4byojqfu1En8SA97u1Bs=
-----END PUBLIC KEY-----
`;

export const CLI_RELEASE_PUBLIC_KEY_FINGERPRINT =
  'sha256:c53ce36602db71b41c10a2fbfe5752de322b9e1b7fb4c415121cbad5ec2ec016';

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
