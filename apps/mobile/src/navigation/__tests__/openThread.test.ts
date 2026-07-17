import { openThread } from "../openThread";

type Route = { name: string; params?: object };

interface FakeNav {
  dispatched: unknown[];
  getParent: () => FakeNav | undefined;
  getState: () => { routes: Route[] };
  dispatch: (action: never) => void;
}

function fakeNav(routes: Route[], parent?: FakeNav): FakeNav {
  const dispatched: unknown[] = [];
  return {
    dispatched,
    getParent: () => parent,
    getState: () => ({ routes }),
    dispatch: (action: unknown) => dispatched.push(action),
  };
}

const thread = (noteId: string): Route => ({ name: "NoteThread", params: { noteId } });

describe("openThread", () => {
  it("pushes NoteThread with the target params", () => {
    const nav = fakeNav([{ name: "Tabs" }]);
    openThread(nav, { noteId: "n1", rootId: "r1" });
    expect(nav.dispatched).toHaveLength(1);
    expect(nav.dispatched[0]).toMatchObject({
      type: "PUSH",
      payload: { name: "NoteThread", params: { noteId: "n1", rootId: "r1" } },
    });
  });

  it("no-ops when the target thread is already focused", () => {
    const nav = fakeNav([{ name: "Tabs" }, thread("n1")]);
    openThread(nav, { noteId: "n1", rootId: "r1" });
    expect(nav.dispatched).toHaveLength(0);
  });

  it("pushes when a DIFFERENT thread is focused (no upstack match)", () => {
    const nav = fakeNav([thread("other")]);
    openThread(nav, { noteId: "n1" });
    expect(nav.dispatched[0]).toMatchObject({ type: "PUSH" });
  });

  it("dispatches on the ROOT navigator from tab-nested call sites", () => {
    const root = fakeNav([{ name: "Tabs" }]);
    const tab = fakeNav([{ name: "SpacesHome" }], root);
    openThread(tab, { noteId: "n1" });
    expect(tab.dispatched).toHaveLength(0);
    expect(root.dispatched).toHaveLength(1);
  });

  it("pops back to an existing instance across a contiguous thread run", () => {
    const nav = fakeNav([{ name: "Tabs" }, thread("root"), thread("a"), thread("b")]);
    openThread(nav, { noteId: "root", rootId: "root" });
    expect(nav.dispatched).toHaveLength(1);
    expect(nav.dispatched[0]).toMatchObject({
      type: "POP_TO",
      payload: {
        name: "NoteThread",
        params: { noteId: "root", rootId: "root" },
        merge: true,
      },
    });
  });

  it("pops to the MOST RECENT matching instance", () => {
    const nav = fakeNav([thread("root"), thread("a"), thread("root"), thread("b")]);
    openThread(nav, { noteId: "root" });
    // Match at index 2 (not 0): everything above it is still a thread run.
    expect(nav.dispatched[0]).toMatchObject({ type: "POP_TO" });
  });

  it("pushes instead of popping across a non-thread detour", () => {
    const nav = fakeNav([
      { name: "Tabs" },
      thread("root"),
      { name: "Profile", params: { pubkey: "p" } },
      thread("a"),
    ]);
    openThread(nav, { noteId: "root" });
    // Popping would discard the Profile leg of the back trail.
    expect(nav.dispatched[0]).toMatchObject({ type: "PUSH" });
  });
});
