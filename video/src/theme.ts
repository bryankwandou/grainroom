/**
 * The darkroom palette, shared with the site and the pitch deck.
 *
 * One warm source, one cool counter, paper for type. Nothing is pure black:
 * a print never is, and pure black crushes on compression anyway.
 */
export const C = {
  ground: "#0d0c0b",
  tray: "#100f0d",
  edge: "#2a251d",
  edgeSoft: "#1e1a15",
  paper: "#efe7d9",
  paperDim: "#cdc4b6",
  grey: "#8c8177",
  greyDeep: "#5b544d",
  safelight: "#e39b2e",
  fixer: "#74a98d",
} as const;

/**
 * One spring, used everywhere.
 *
 * A different easing per scene is the clearest signal that a video was
 * assembled rather than directed. Heavy damping means things arrive and
 * settle, the way paper moves in a tray, rather than bouncing.
 */
export const SETTLE = { damping: 200, mass: 1, stiffness: 90 } as const;
