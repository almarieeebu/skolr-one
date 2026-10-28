// Temporary passwords that are easy to read and type on a phone:
// three short words and two digits, e.g. "mango-river-sunny-27".

export const WORDS = [
  "apple", "banana", "mango", "lemon", "melon", "grape", "peach", "cherry",
  "river", "ocean", "island", "beach", "cloud", "rain", "storm", "sunny",
  "tiger", "eagle", "panda", "otter", "whale", "dolphin", "rabbit", "falcon",
  "green", "purple", "orange", "silver", "golden", "yellow", "violet", "coral",
  "pencil", "paper", "book", "chalk", "ruler", "globe", "laptop", "music",
  "happy", "brave", "quick", "calm", "bright", "kind", "smart", "proud",
  "mountain", "forest", "garden", "valley", "meadow", "bamboo", "palm", "lotus",
  "rocket", "planet", "comet", "star", "moon", "sunset", "rainbow", "breeze",
];

/** Random integer in [0, max). Uses the browser / Node crypto when there is one. */
export function cryptoInt(max: number): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    // Rejection sampling: no bias towards small numbers.
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    do c.getRandomValues(buf);
    while (buf[0] >= limit);
    return buf[0] % max;
  }
  return Math.floor(Math.random() * max);
}

/** Three different words and two digits, joined by dashes. `rand(max)` returns 0..max-1. */
export function generateTempPassword(rand: (max: number) => number = cryptoInt): string {
  const words: string[] = [];
  while (words.length < 3) {
    const w = WORDS[rand(WORDS.length)];
    if (!words.includes(w)) words.push(w);
  }
  const digits = String(rand(90) + 10); // 10..99, always two digits
  return `${words.join("-")}-${digits}`;
}

export const TEMP_PASSWORD = /^[a-z]+-[a-z]+-[a-z]+-\d{2}$/;

/** Rules for the new password the applicant picks. Empty list = OK. */
export function checkNewPassword(next: string, confirm: string, temporary?: string): string[] {
  const problems: string[] = [];
  if (next.length < 8) problems.push("Use at least 8 characters.");
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) problems.push("Use letters and at least one number.");
  if (temporary && next === temporary) problems.push("Pick a new password, not the temporary one.");
  if (next !== confirm) problems.push("The two passwords do not match.");
  return problems;
}
