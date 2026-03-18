/**
 * Connection quality monitoring for voice/video calls.
 */

export interface ConnectionStats {
  /** Round-trip time in milliseconds */
  rtt: number;
  /** Packet loss percentage (0-100) */
  packetLoss: number;
  /** Available send bandwidth in kbps */
  sendBandwidth: number;
  /** Available receive bandwidth in kbps */
  receiveBandwidth: number;
  /** Jitter in milliseconds */
  jitter: number;
}

/**
 * Get connection stats from an RTCPeerConnection.
 */
export async function getConnectionStats(
  pc: RTCPeerConnection,
): Promise<ConnectionStats> {
  const stats = await pc.getStats();
  let rtt = 0;
  let packetLoss = 0;
  let sendBandwidth = 0;
  let receiveBandwidth = 0;
  let jitter = 0;

  stats.forEach((report) => {
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      rtt = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 0;
      sendBandwidth = report.availableOutgoingBitrate
        ? report.availableOutgoingBitrate / 1000
        : 0;
    }

    if (report.type === "inbound-rtp" && report.kind === "audio") {
      if (report.packetsLost && report.packetsReceived) {
        const total = report.packetsLost + report.packetsReceived;
        packetLoss = total > 0 ? (report.packetsLost / total) * 100 : 0;
      }
      jitter = report.jitter ? report.jitter * 1000 : 0;
    }

    if (report.type === "remote-inbound-rtp") {
      receiveBandwidth = report.availableIncomingBitrate
        ? report.availableIncomingBitrate / 1000
        : receiveBandwidth;
    }
  });

  return { rtt, packetLoss, sendBandwidth, receiveBandwidth, jitter };
}

/**
 * Derive a quality label from connection stats.
 */
export function deriveQuality(
  stats: ConnectionStats,
): "excellent" | "good" | "poor" {
  if (stats.rtt < 100 && stats.packetLoss < 1 && stats.jitter < 30) {
    return "excellent";
  }
  if (stats.rtt < 250 && stats.packetLoss < 5 && stats.jitter < 50) {
    return "good";
  }
  return "poor";
}
