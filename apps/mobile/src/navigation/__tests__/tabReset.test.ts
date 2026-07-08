import { tabResetAction } from "../tabReset";

const stack = (names: string[], index?: number) => ({
  key: "stack-1",
  index: index ?? names.length - 1,
  routes: names.map((name) => ({ name })),
});

describe("tabResetAction", () => {
  it("resets a deep-linked single-route stack to the root", () => {
    const action = tabResetAction(stack(["SpaceFeed"]), "SpaceList");
    expect(action).toMatchObject({
      type: "RESET",
      target: "stack-1",
      payload: { index: 0, routes: [{ name: "SpaceList" }] },
    });
  });

  it("resets a deep stack to the root", () => {
    const action = tabResetAction(stack(["SpaceList", "Space", "Channel"]), "SpaceList");
    expect(action).toMatchObject({ target: "stack-1" });
  });

  it("no-ops when already resting on the root", () => {
    expect(tabResetAction(stack(["SpaceList"]), "SpaceList")).toBeNull();
  });

  it("no-ops without nested state (tab never navigated)", () => {
    expect(tabResetAction(undefined, "SpaceList")).toBeNull();
    expect(tabResetAction({}, "SpaceList")).toBeNull();
    expect(tabResetAction({ key: "k", routes: [] }, "SpaceList")).toBeNull();
  });
});
