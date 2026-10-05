/**
 * Does `content` have the shape of a NIP-44 v2 payload (base64, version byte
 * 0x02, at least the minimum payload length)? Private music events come in two
 * forms: desktop's NIP-44-encrypted metadata, and soot's cleartext tags with
 * empty or plain-text content. This tells them apart without a decrypt, so a
 * cleartext description is never mistaken for a ciphertext the viewer "can't
 * read", and a real ciphertext that fails to decrypt is never treated as
 * cleartext.
 */
export function looksLikeNip44(content: string): boolean {
  if (content.length < 132 || content.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return false;
  try {
    return atob(content.slice(0, 4)).charCodeAt(0) === 2;
  } catch {
    return false;
  }
}
