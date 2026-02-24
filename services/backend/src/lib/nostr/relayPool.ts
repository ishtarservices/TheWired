/** WebSocket connection pool for relay ingestion */
export class RelayPool {
  private connections: Map<string, WebSocket> = new Map();

  connect(url: string): WebSocket {
    const existing = this.connections.get(url);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return existing;
    }
    const ws = new WebSocket(url);
    this.connections.set(url, ws);
    return ws;
  }

  disconnect(url: string) {
    const ws = this.connections.get(url);
    if (ws) {
      ws.close();
      this.connections.delete(url);
    }
  }

  disconnectAll() {
    for (const [url, ws] of this.connections) {
      ws.close();
      this.connections.delete(url);
    }
  }
}
