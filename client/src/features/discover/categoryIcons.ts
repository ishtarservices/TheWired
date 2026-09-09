import {
  Bitcoin,
  BookOpen,
  Boxes,
  Cpu,
  Gamepad2,
  GraduationCap,
  Heart,
  Microscope,
  MoreHorizontal,
  Music,
  Newspaper,
  Palette,
  Scale,
  Shuffle,
  Trophy,
  Tv,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

// The backend names each discovery category's icon as a lucide component
// string ("Gamepad2"). The names it seeds are mapped statically so the icon
// set stays tree-shakeable; anything unknown falls back to Boxes — the app's
// existing "a space" glyph — rather than rendering nothing.

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Bitcoin,
  BookOpen,
  Cpu,
  Gamepad2,
  GraduationCap,
  Heart,
  Microscope,
  MoreHorizontal,
  Music,
  Newspaper,
  Palette,
  Scale,
  Shuffle,
  Trophy,
  Tv,
  Users,
  Zap,
};

export function categoryIcon(name: string | null | undefined): LucideIcon {
  return (name && CATEGORY_ICONS[name]) || Boxes;
}
