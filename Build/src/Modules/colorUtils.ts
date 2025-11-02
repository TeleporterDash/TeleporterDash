import Color from "color";

export interface RGBColor {
  r: number;
  g: number;
  b: number;
  alpha?: number;
}

export interface HSLColor {
  h: number;
  s: number;
  l: number;
}

const clampMixIntensity = (value: number): number =>
  Math.min(Math.max(value, 0), 1);

export const hexToRGB = (hex: string): RGBColor => {
  const { r, g, b, alpha } = Color(hex).rgb().object();
  return alpha === undefined ? { r, g, b } : { r, g, b, alpha };
};

export const rgbToHex = (r: number, g: number, b: number): string =>
  Color.rgb(r, g, b).hex();

export const hexToHSL = (hex: string): HSLColor => {
  const [h, s, l] = Color(hex).hsl().array();
  return { h, s, l };
};

export const hslToHex = (h: number, s: number, l: number): string =>
  Color.hsl(h, s, l).hex();

export const blendColors = (
  color1: string,
  color2: string,
  intensity: number
): string =>
  Color(color1).mix(Color(color2), clampMixIntensity(intensity)).hex();

export const hexToNumber = (hex: string): number => Color(hex).rgbNumber();
