import type { SpringConfig } from './spring';

/**
 * The one place to tune how motion feels. `damping` 1 is critically damped (no overshoot); lower values settle
 * a little past the target and come back. Clear Street's system prefers no bounce, so 1 is the conservative choice.
 * To revert the bouncier feel: set LAYOUT_SPRING.damping to 1 and NODE_RELEASE_EASE to the plain ease below.
 */
export const LAYOUT_SPRING: SpringConfig = { response: 0.45, damping: 0.7 };
export const ZOOM_SPRING: SpringConfig = { response: 0.3, damping: 1 };
/** Bottom sheet on small screens: Apple's drawer values (damping 0.8, response 0.3), a little settle after a flick. */
export const SHEET_SPRING: SpringConfig = { response: 0.32, damping: 0.8 };
