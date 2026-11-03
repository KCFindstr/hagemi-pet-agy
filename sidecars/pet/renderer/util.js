HAGEMI.MARGIN = 220;
HAGEMI.util = {
  clamp: (value, low, high) => Math.min(high, Math.max(low, value)),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (low, high) => low + Math.random() * (high - low),
  smooth(a, b, value) {
    const t = Math.min(1, Math.max(0, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  },
  gauss: (x, y, cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)),
};
