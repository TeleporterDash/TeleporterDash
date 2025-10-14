import Color from 'color';

export const hexToRGB = (hex) => Color(hex).rgb().object();
export const rgbToHex = (r, g, b) => Color.rgb(r, g, b).hex();
export const hexToHSL = (hex) => Color(hex).hsl().array();
export const hslToHex = (h, s, l) => Color.hsl(h, s, l).hex();
export const blendColors = (color1, color2, intensity) => 
  Color(color1).mix(Color(color2), intensity).hex();
export const hexToNumber = (hex) => Color(hex).rgbNumber();