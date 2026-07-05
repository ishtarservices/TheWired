import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class composition — same helper as the desktop client. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
