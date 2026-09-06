/**
 * Escape a string for interpolation into a Meilisearch filter expression.
 *
 * Filter values are wrapped in double quotes (`genre = "<value>"`), so a value
 * containing a `"` or a `\` can terminate the literal early and inject
 * arbitrary filter syntax. Both characters are dropped rather than
 * backslash-escaped: Meilisearch has no portable escape sequence inside a
 * quoted literal, and no legitimate genre/hashtag/pubkey contains them.
 *
 * Every caller that builds a quoted filter from user input MUST route the
 * value through this — see searchService, musicService and ingestHandlers.
 */
export function escapeMsFilter(value: string): string {
  return value.replace(/[\\"]/g, "");
}
