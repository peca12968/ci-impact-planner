function parseHex(value) {
  if (typeof value !== "string" || !/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    throw new Error(`Expected a CSS hex color, got ${JSON.stringify(value)}`);
  }
  let hex = value.slice(1);
  if (hex.length <= 4) hex = [...hex].map(digit => digit + digit).join("");
  if (hex.length === 6) hex += "ff";
  return hex.match(/../g).map(byte => parseInt(byte, 16) / 255);
}

function over(color, opaqueBackground) {
  const alpha = color[3];
  return opaqueBackground.map((channel, i) => color[i] * alpha + channel * (1 - alpha));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Layers are uniform sRGB colors ordered from the opaque canvas toward the text.
export function checkText({foreground, backgrounds, scale}) {
  if (!Array.isArray(backgrounds) || !backgrounds.length)
    throw new Error("Expected at least an opaque canvas background");
  if (scale !== "normal" && scale !== "large")
    throw new Error("Expected normal or large text scale");
  const [canvas, ...layers] = backgrounds.map(parseHex);
  if (canvas[3] !== 1) throw new Error("Canvas must be opaque");
  const bg = layers.reduce((under, layer) => over(layer, under), canvas.slice(0, 3));
  const text = luminance(over(parseHex(foreground), bg));
  const surface = luminance(bg);
  const ratio = (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
  const minimum = scale === "normal" ? 4.5 : 3;
  return {ratio, minimum, passes: ratio >= minimum};
}
