import { delay } from "@std/async";

/** Inclusive integer in [min, max]. */
export function rand(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function pick<T>(arr: readonly T[]): T {
  return arr[rand(0, arr.length - 1)];
}

export function chance(p = 0.5) {
  return Math.random() < p;
}

/** Random settle delay between trader / core-manage actions. */
export async function randDelay(min = 1500, max = 6000) {
  await delay(rand(min, max));
}

/**
 * Request amount in kopecks: ~1000 RUB base with a small jitter.
 * Collisions are tolerated, the jitter just lowers their frequency.
 */
export function randAmount() {
  return 100_000 + rand(0, 50) * 100;
}
