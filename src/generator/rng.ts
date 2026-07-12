/** Seeded PRNG (mulberry32) so --seed makes the whole generator deterministic. */
export function createRng(seed: number) {
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    int(min: number, max: number): number {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    bool(probability: number): boolean {
      return next() < probability;
    },
    choice<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)]!;
    },
    float(min: number, max: number): number {
      return next() * (max - min) + min;
    },
  };
}

export type Rng = ReturnType<typeof createRng>;
