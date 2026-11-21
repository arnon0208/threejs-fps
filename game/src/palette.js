// Ember Yard look plan, in one place. Dusk industrial yard: warm dark ground, rust
// and amber accents, cool teal for hazard marking. The same names are the CSS custom
// properties in index.html, so the page chrome and the 3D scene share one palette.
export const PALETTE = {
  canvas: '#171310',
  surface: '#241d17',
  hairline: '#3b3128',
  ink: '#f0e8d8',
  muted: '#a89a86',
  accent: '#e8862e',
  ember: '#c94f2a',
  teal: '#3fa08f',
  rust: '#8a4a28',
  olive: '#6e6b3a',
  ground: '#2b241d',
  concrete: '#4a4238',
  containerA: '#7a4a26',
  containerB: '#3d5a52',
  containerC: '#5d5a33',
  skyTop: '#2a1f1a',
  skyBottom: '#5c3a22',
  fog: '#3a2a1e',
};

// The palette as three.js hex numbers, for materials that need them.
export const HEX = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, parseInt(v.slice(1), 16)]),
);
