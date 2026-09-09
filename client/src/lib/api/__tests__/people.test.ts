import { describe, it, expect } from "vitest";
import { parsePeople } from "../people";

const ROW = {
  name: "Gothic Monk",
  display_name: "Gothic Monk",
  nip05: "gothicmonk@thewired.app",
  about: "Biochemical -9",
  pubkey: "6a3ee522af4a80a75a078a1db529e74af757a145bda596fdc1ec2bb5a53a86e5",
  picture: "https://blossom.primal.net/ee38.png",
  note_count: 4,
  has_nip05: true,
};

describe("parsePeople", () => {
  it("parses the {data:{people,total}} envelope into camelCase", () => {
    const [person] = parsePeople({ data: { people: [ROW], total: 1 } });
    expect(person).toEqual({
      pubkey: ROW.pubkey,
      name: "Gothic Monk",
      displayName: "Gothic Monk",
      nip05: "gothicmonk@thewired.app",
      about: "Biochemical -9",
      picture: "https://blossom.primal.net/ee38.png",
      noteCount: 4,
      hasNip05: true,
    });
  });

  it("also accepts the unwrapped {people,total} object the api() wrapper yields", () => {
    expect(parsePeople({ people: [ROW], total: 1 })).toHaveLength(1);
  });

  it("degrades to [] on shape changes rather than throwing", () => {
    expect(parsePeople(null)).toEqual([]);
    expect(parsePeople("nope")).toEqual([]);
    expect(parsePeople({ data: [ROW] })).toEqual([]); // array, not {people}
    expect(parsePeople({ data: { people: "nope" } })).toEqual([]);
  });

  it("drops rows with no pubkey — the only field a row is useless without", () => {
    const rows = parsePeople({
      data: { people: [ROW, { name: "ghost" }, { pubkey: "" }, null] },
    });
    expect(rows).toHaveLength(1);
  });

  it("never reports verified without an actual handle", () => {
    // has_nip05 is derived server-side; if the handle is missing the claim
    // would be one we can't back.
    const [person] = parsePeople({
      data: { people: [{ ...ROW, nip05: null, has_nip05: true }] },
    });
    expect(person.hasNip05).toBe(false);
  });

  it("defaults an absent note_count to 0 rather than NaN", () => {
    const [person] = parsePeople({
      data: { people: [{ ...ROW, note_count: undefined }] },
    });
    expect(person.noteCount).toBe(0);
  });

  it("normalizes empty strings to null so callers can just check truthiness", () => {
    const [person] = parsePeople({
      data: { people: [{ ...ROW, about: "", picture: "" }] },
    });
    expect(person.about).toBeNull();
    expect(person.picture).toBeNull();
  });
});
