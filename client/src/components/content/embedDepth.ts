import { createContext } from "react";

/**
 * How deeply nested the current inline embed is.
 *   0 = top-level (full interactive card)
 *   1 = inside one embed (compact card, no engagement bar)
 *  >=2 = render the reference as a plain link, with no further fetching
 *
 * This bounds recursion when a note embeds a note that embeds a note…
 */
export const EmbedDepthContext = createContext(0);

/** Beyond this depth, references render as a plain link instead of a card. */
export const MAX_EMBED_DEPTH = 2;
