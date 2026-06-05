/**
 * Auto-closes incomplete markdown so a streaming partial renders cleanly instead
 * of flashing raw `**`, backticks, or an open code fence. Conservative: only
 * repairs the common visible cases (unterminated fence, bold, inline code on the
 * last line). Run only while streaming; the final content is rendered verbatim.
 */
export function repairMarkdown(input: string): string {
  let text = input;

  // Inside an unterminated fenced code block (odd number of ``` fences) →
  // close it so the body renders as a code block, not leaked markup.
  const fences = text.match(/```/g);
  if (fences && fences.length % 2 === 1) {
    if (!text.endsWith("\n")) text += "\n";
    return text + "```";
  }

  // Dangling bold run.
  const bold = text.match(/\*\*/g);
  if (bold && bold.length % 2 === 1) text += "**";

  // Dangling inline code span on the final line.
  const lastLine = text.slice(text.lastIndexOf("\n") + 1);
  const ticks = lastLine.replace(/```/g, "").match(/`/g);
  if (ticks && ticks.length % 2 === 1) text += "`";

  return text;
}
