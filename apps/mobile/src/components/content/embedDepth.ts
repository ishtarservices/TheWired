import { createContext } from "react";

/**
 * How deeply nested the current inline embed is (desktop embedDepth.ts).
 *   0  = top-level — event/addr refs render as full embedded cards
 *   1  = inside a card — refs render as COMPACT nested cards (a quote of a
 *        quote still shows its inner quote, desktop parity)
 *  >=2 = deeper — refs render as plain tappable links, no fetching
 *
 * This bounds recursion when a note embeds a note that embeds a note…
 */
export const EmbedDepthContext = createContext(0);

/** At or beyond this depth, references render as links instead of cards. */
export const MAX_EMBED_DEPTH = 2;
