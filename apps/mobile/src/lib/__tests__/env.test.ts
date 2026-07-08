import { devHostFromHostUri, resolveApiBase, resolveAppRelay } from "../env";

describe("devHostFromHostUri", () => {
  it("extracts the Metro machine's host", () => {
    expect(devHostFromHostUri("127.0.0.1:8081")).toBe("127.0.0.1");
    expect(devHostFromHostUri("192.168.1.5:8107")).toBe("192.168.1.5");
  });

  it("falls back to localhost when Metro is absent", () => {
    expect(devHostFromHostUri(undefined)).toBe("localhost");
    expect(devHostFromHostUri("")).toBe("localhost");
  });
});

describe("resolveApiBase", () => {
  it("dev → local gateway on the Metro host (desktop parity)", () => {
    expect(resolveApiBase({ override: undefined, dev: true, devHost: "127.0.0.1" })).toBe(
      "http://127.0.0.1:9080/api",
    );
  });

  it("release → production", () => {
    expect(resolveApiBase({ override: undefined, dev: false, devHost: "127.0.0.1" })).toBe(
      "https://api.thewired.app/api",
    );
  });

  it("explicit env override always wins", () => {
    expect(
      resolveApiBase({ override: "https://staging.thewired.app/api", dev: true, devHost: "x" }),
    ).toBe("https://staging.thewired.app/api");
  });
});

describe("resolveAppRelay", () => {
  it("dev → local relay; release → production; override wins", () => {
    expect(resolveAppRelay({ override: undefined, dev: true, devHost: "127.0.0.1" })).toBe(
      "ws://127.0.0.1:7777",
    );
    expect(resolveAppRelay({ override: undefined, dev: false, devHost: "127.0.0.1" })).toBe(
      "wss://relay.thewired.app",
    );
    expect(resolveAppRelay({ override: "wss://relay.thewired.app", dev: true, devHost: "x" })).toBe(
      "wss://relay.thewired.app",
    );
  });
});
