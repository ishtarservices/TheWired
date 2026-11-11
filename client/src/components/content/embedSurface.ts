import { createContext } from "react";

/**
 * Where embedded cards (shared posts, link embeds) are being drawn. `message`:
 * inside a chat or DM message, where cards are width-capped and their media
 * uses the compact chat size instead of the full feed size.
 */
export type EmbedSurface = "feed" | "message";

export const EmbedSurfaceContext = createContext<EmbedSurface>("feed");
