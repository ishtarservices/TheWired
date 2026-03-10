interface GenreCardProps {
  genre: string;
  count: number;
  isActive?: boolean;
  onClick: () => void;
}

const GENRE_GRADIENTS: Record<string, string> = {
  ambient: "from-blue-900/60 to-blue-800/40",
  blues: "from-indigo-900/60 to-indigo-700/40",
  classical: "from-amber-900/60 to-amber-700/40",
  country: "from-yellow-900/60 to-yellow-700/40",
  dance: "from-pink-900/60 to-pink-600/40",
  electronic: "from-cyan-900/60 to-cyan-600/40",
  experimental: "from-violet-900/60 to-violet-600/40",
  folk: "from-green-900/60 to-green-700/40",
  funk: "from-orange-900/60 to-orange-600/40",
  "hip-hop": "from-red-900/60 to-red-700/40",
  house: "from-fuchsia-900/60 to-fuchsia-600/40",
  indie: "from-teal-900/60 to-teal-600/40",
  jazz: "from-amber-900/60 to-amber-600/40",
  metal: "from-slate-900/60 to-slate-600/40",
  pop: "from-rose-900/60 to-rose-600/40",
  punk: "from-lime-900/60 to-lime-600/40",
  "r&b": "from-purple-900/60 to-purple-600/40",
  rock: "from-stone-900/60 to-stone-600/40",
  soul: "from-orange-900/60 to-orange-700/40",
  techno: "from-gray-900/60 to-gray-600/40",
  trance: "from-sky-900/60 to-sky-600/40",
  trap: "from-red-900/60 to-red-600/40",
};

function getGradient(genre: string): string {
  return GENRE_GRADIENTS[genre.toLowerCase()] ?? "from-pulse/40 to-pulse-soft/20";
}

export function GenreCard({ genre, count, isActive, onClick }: GenreCardProps) {
  return (
    <button
      onClick={onClick}
      className={`flex w-32 shrink-0 flex-col justify-end rounded-xl bg-gradient-to-br p-3 transition-all duration-150 hover:scale-[1.03] ${getGradient(genre)} ${
        isActive ? "ring-1 ring-pulse/60" : ""
      }`}
      style={{ minHeight: 80 }}
    >
      <span className="text-sm font-semibold text-heading">{genre}</span>
      <span className="text-[10px] text-soft">
        {count} track{count !== 1 ? "s" : ""}
      </span>
    </button>
  );
}
