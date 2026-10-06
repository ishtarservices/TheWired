import { describe, it, expect } from "vitest";
import { matchMusicEmbed, findMusicEmbedInText } from "../musicEmbeds";

describe("matchMusicEmbed", () => {
  it("canonicalises every supported provider (shared dedupe keys with soot)", () => {
    expect(matchMusicEmbed("https://youtu.be/dQw4w9WgXcQ?si=abc")?.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(matchMusicEmbed("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD")).toMatchObject({ subtype: "song", thumb: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    expect(matchMusicEmbed("https://www.youtube.com/playlist?list=PL123")).toMatchObject({ provider: "youtube", subtype: "playlist", id: "PL123" });
    expect(matchMusicEmbed("https://m.soundcloud.com/Artist/Some-Track?in=x")).toMatchObject({ canonicalUrl: "https://soundcloud.com/artist/some-track", subtype: "track" });
    expect(matchMusicEmbed("https://soundcloud.com/artist/sets/an-ep")).toMatchObject({ subtype: "set" });
    expect(matchMusicEmbed("https://soundcloud.com/discover")).toBeNull();
    expect(matchMusicEmbed("https://Band.bandcamp.com/album/The-Album?from=x")).toMatchObject({ canonicalUrl: "https://band.bandcamp.com/album/the-album", subtype: "album" });
    expect(matchMusicEmbed("https://open.spotify.com/intl-de/album/1A2b3C?si=q")).toMatchObject({ canonicalUrl: "https://open.spotify.com/album/1A2b3C", subtype: "album" });
    expect(matchMusicEmbed("https://music.apple.com/us/album/some-album/123456?i=7890")).toMatchObject({ canonicalUrl: "https://music.apple.com/us/album/some-album/123456?i=7890", subtype: "song" });
    expect(matchMusicEmbed("https://music.apple.com/gb/playlist/mix/pl.abc")).toMatchObject({ subtype: "playlist" });
  });

  it("returns null for non-music and non-http input", () => {
    expect(matchMusicEmbed("https://example.com/track/1")).toBeNull();
    expect(matchMusicEmbed("https://www.youtube.com/@channel")).toBeNull();
    expect(matchMusicEmbed("youtu.be/dQw4w9WgXcQ")).toBeNull();
  });

  it("finds the first provider link in free text", () => {
    expect(findMusicEmbedInText("hear this https://example.com and https://youtu.be/dQw4w9WgXcQ now")?.provider).toBe("youtube");
    expect(findMusicEmbedInText("nothing here")).toBeNull();
  });
});
