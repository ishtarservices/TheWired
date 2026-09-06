export type Corner = "tl" | "tr" | "bl" | "br";

/** Corner closest to a point inside a W×H box (PiP snap on drag release). */
export function nearestCorner(x: number, y: number, width: number, height: number): Corner {
  const right = x > width / 2;
  const bottom = y > height / 2;
  if (bottom) return right ? "br" : "bl";
  return right ? "tr" : "tl";
}
