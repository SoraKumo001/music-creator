/** seed付き決定的乱数。生成の多様化と再現性の両立用。 */

/** 文字列を32bit seedへ (FNV-1a) */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seed解決: 明示seedがあればそれ、なければpromptハッシュ+時刻由来 */
export function resolveSeed(prompt: string, seed?: number): number {
  if (seed !== undefined && Number.isFinite(seed)) return seed >>> 0;
  return (hashSeed(prompt) ^ (Date.now() & 0xffffffff)) >>> 0;
}

/** 配列からseed付きでk件サンプル (順序もシャッフル) */
export function sampleSeeded<T>(items: readonly T[], k: number, rand: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, Math.max(0, Math.min(k, arr.length)));
}

/** softmaxサンプリング: scoresが高いほど選ばれやすいが、seedで揺れる */
export function pickSoftmaxSeeded(scores: number[], rand: () => number, temperature = 8): number {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return 0;
  const max = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - max) / Math.max(1e-6, temperature)));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = rand() * sum;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return i;
  }
  return scores.length - 1;
}
