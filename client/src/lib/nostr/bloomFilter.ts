/**
 * Browser-native Bloom filter using TypedArrays.
 * No Node.js Buffer dependency.
 */
export class SimpleBloomFilter {
  private bits: Uint8Array;
  private numHashes: number;
  private size: number;

  constructor(expectedItems: number, fpr: number) {
    // Optimal bit array size: m = -n*ln(p) / (ln2)^2
    this.size = Math.ceil(
      (-expectedItems * Math.log(fpr)) / (Math.LN2 * Math.LN2),
    );
    // Optimal hash count: k = (m/n) * ln2
    this.numHashes = Math.max(1, Math.round((this.size / expectedItems) * Math.LN2));
    this.bits = new Uint8Array(Math.ceil(this.size / 8));
  }

  add(item: string): void {
    for (let i = 0; i < this.numHashes; i++) {
      const idx = this.hash(item, i) % this.size;
      this.bits[idx >>> 3] |= 1 << (idx & 7);
    }
  }

  has(item: string): boolean {
    for (let i = 0; i < this.numHashes; i++) {
      const idx = this.hash(item, i) % this.size;
      if ((this.bits[idx >>> 3] & (1 << (idx & 7))) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * FNV-1a inspired hash with seed mixing.
   * Fast, good distribution for hex strings (event IDs).
   */
  private hash(str: string, seed: number): number {
    let h = 0x811c9dc5 ^ seed;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // Ensure positive
    return h >>> 0;
  }
}
