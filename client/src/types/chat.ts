/** Chat message display state */
export interface ChatMessage {
  eventId: string;
  pubkey: string;
  content: string;
  createdAt: number;
  replyTo?: string;
  status: "pending" | "confirmed" | "failed";
}

/** Optimistic send tracking */
export interface PendingSend {
  tempId: string;
  content: string;
  replyTo?: string;
  createdAt: number;
  retryCount: number;
}
