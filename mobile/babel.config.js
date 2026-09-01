module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-draggable-flatlist가 내부적으로 react-native-reanimated를
    // 씁니다 — 이 플러그인은 반드시 plugins 배열의 마지막에 있어야 합니다.
    plugins: ["react-native-reanimated/plugin"],
  };
};
