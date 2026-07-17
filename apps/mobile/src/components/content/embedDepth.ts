import { createContext } from "react";

/**
 * How deeply nested the current inline embed is (desktop embedDepth.ts).
 *   0  = top-level — event/addr refs render as compact embedded cards
 *  >=1 = inside an embed — refs render as plain tappable links, no fetching
 *
 * This bounds recursion when a note embeds a note that embeds a note…
 * Mobile allows one card level (desktop allows two): nested cards don't
 * read at phone widths.
 */
export const EmbedDepthContext = createContext(0);

/** At or beyond this depth, references render as links instead of cards. */
export const MAX_EMBED_DEPTH = 1;
