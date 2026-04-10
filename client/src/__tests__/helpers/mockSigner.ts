/**
 * TestSigner: a NostrSigner implementation backed by a raw secret key,
 * for use in test suites. Uses nostr-tools pure crypto (no browser/Tauri).
 */
import { getPublicKey, finalizeEvent } from "nostr-tools";
import type { UnsignedEvent, NostrEvent } from "@/types/nostr";
import type { TestUser } from "../fixtures/testUsers";

export class TestSigner {
  private secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey;
  }

  async getPublicKey(): Promise<string> {
    return getPublicKey(this.secretKey);
  }

  async signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    return finalizeEvent(unsigned, this.secretKey) as unknown as NostrEvent;
  }
}

/** Create a TestSigner from a TestUser fixture */
export function createTestSigner(user: TestUser): TestSigner {
  return new TestSigner(user.secretKey);
}
