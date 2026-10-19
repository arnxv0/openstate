export const WAKE_PHRASE = "Hey World";

const WAKE = /\b(?:hey|hi|hay|okay|ok)[\s,.!-]*worlds?(?:[\s-]*state)?\b[\s,.!?-]*/i;

export function matchWake(text: string): { woke: boolean; rest: string } {
  const match = WAKE.exec(text);
  if (!match) return { woke: false, rest: "" };
  return { woke: true, rest: text.slice(match.index + match[0].length).trim() };
}

export function hasWords(text: string, min = 2) {
  return text.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length >= min;
}
