import { useState, useEffect, useCallback, useRef } from "react";
import { saveUserState, getUserState } from "@/lib/db/userStateStore";

const STORAGE_KEY = "artist_images";

/** Cache so multiple components reading the same artist don't re-fetch from IDB */
let memoryCache: Record<string, string> | null = null;

async function loadAll(): Promise<Record<string, string>> {
  if (memoryCache) return memoryCache;
  const stored = await getUserState<Record<string, string>>(STORAGE_KEY);
  memoryCache = stored ?? {};
  return memoryCache;
}

async function persistAll(data: Record<string, string>): Promise<void> {
  memoryCache = data;
  await saveUserState(STORAGE_KEY, data);
}

/**
 * Hook for managing locally-stored artist profile images.
 * Works for both pubkey-based and text-only artists.
 * The `artistKey` should be the pubkey or `"name:<normalized>"`.
 */
export function useArtistImage(artistKey: string) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadAll()
      .then((all) => {
        if (all[artistKey]) setImageUrl(all[artistKey]);
      })
      .catch(() => {/* IDB unavailable */});
  }, [artistKey]);

  const setImage = useCallback(
    async (url: string) => {
      const all = await loadAll();
      const updated = { ...all, [artistKey]: url };
      await persistAll(updated);
      setImageUrl(url);
    },
    [artistKey],
  );

  const clearImage = useCallback(async () => {
    const all = await loadAll();
    const updated = { ...all };
    delete updated[artistKey];
    await persistAll(updated);
    setImageUrl(null);
  }, [artistKey]);

  const pickImage = useCallback(() => {
    // Create a temporary file input, trigger it, read the result as a data URL
    if (!inputRef.current) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setImage(reader.result);
          }
        };
        reader.readAsDataURL(file);
        // Reset so the same file can be re-selected
        input.value = "";
      });
      document.body.appendChild(input);
      inputRef.current = input;
    }
    inputRef.current.click();
  }, [setImage]);

  // Cleanup hidden input on unmount
  useEffect(() => {
    return () => {
      if (inputRef.current && inputRef.current.parentNode) {
        inputRef.current.parentNode.removeChild(inputRef.current);
        inputRef.current = null;
      }
    };
  }, []);

  return { imageUrl, setImage, clearImage, pickImage };
}
