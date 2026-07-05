// Jest replacement for react-native-reanimated (wired via moduleNameMapper).
// The library's shipped mock re-imports its real index (which needs the
// react-native-worklets native runtime — absent under Jest), so this is a
// standalone stub covering exactly the API surface the app uses. Values
// resolve immediately; animated components render as their base component.
const { View, Text, Image, ScrollView, FlatList } = require("react-native");

const ID = (value) => value;
const NOOP = () => {};

class AnimationBuilderMock {
  duration() {
    return this;
  }
  delay() {
    return this;
  }
  springify() {
    return this;
  }
  damping() {
    return this;
  }
  stiffness() {
    return this;
  }
  easing() {
    return this;
  }
  reduceMotion() {
    return this;
  }
  build() {
    return () => ({ initialValues: {}, animations: {} });
  }
}

const easingFn = ID;
const Easing = {
  linear: easingFn,
  ease: easingFn,
  quad: easingFn,
  cubic: easingFn,
  sin: easingFn,
  circle: easingFn,
  exp: easingFn,
  inOut: () => easingFn,
  in: () => easingFn,
  out: () => easingFn,
  bezier: () => ({ factory: () => easingFn }),
};

const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  FlatList,
  createAnimatedComponent: ID,
};

module.exports = {
  __esModule: true,
  default: Animated,
  createAnimatedComponent: ID,
  useSharedValue: (init) => ({ value: init }),
  useAnimatedStyle: (factory) => factory(),
  useDerivedValue: (factory) => ({ value: factory() }),
  withSpring: ID,
  withTiming: ID,
  withDelay: (_delay, value) => value,
  withRepeat: ID,
  withSequence: (...values) => values[values.length - 1],
  cancelAnimation: NOOP,
  runOnJS: ID,
  runOnUI: ID,
  Easing,
  ReduceMotion: { System: "system", Always: "always", Never: "never" },
  useReducedMotion: () => false,
  FadeIn: new AnimationBuilderMock(),
  FadeInDown: new AnimationBuilderMock(),
  FadeInUp: new AnimationBuilderMock(),
  FadeOut: new AnimationBuilderMock(),
  FadeOutDown: new AnimationBuilderMock(),
  LinearTransition: new AnimationBuilderMock(),
};
