import { screen } from "@testing-library/react-native";
import { View } from "react-native";

import { LiveDot } from "../LiveDot";
import { renderWithTheme } from "@/test/renderWithTheme";

describe("LiveDot", () => {
  it("renders a token-colored circle and unmounts cleanly", async () => {
    const result = await renderWithTheme(
      <View testID="wrap">
        <LiveDot size={8} />
      </View>,
    );
    const wrap = screen.getByTestId("wrap");
    const dot = wrap.children[0] as unknown as { props: { style: unknown } };
    const flat = Object.assign({}, ...[dot.props.style].flat(Infinity).filter(Boolean));
    expect(flat.width).toBe(8);
    expect(flat.borderRadius).toBe(4);
    expect(typeof flat.backgroundColor).toBe("string");
    // Never a green/red status color — tone comes from the neutral ramp.
    expect(flat.backgroundColor).not.toMatch(/^hsl\(14[0-9]/);
    result.unmount();
  });
});
