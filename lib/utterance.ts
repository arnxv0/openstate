// Cheap reads of an utterance, before any model sees it.

// "Remember this", "register this fridge", "don't record that" need the photo
// and write state; everything else is a question.
const NOT_A_QUESTION =
  /\b(remember|register|note (?:that|this|down)|forget|don'?t record|do not record|stop recording|go private|this is (?:my|the|our))\b/i;

// "What am I looking at", "what is this", "how many are here": only the photo
// answers these, so the reference photos of remembered places go along.
const ABOUT_THE_VIEW =
  /\b(looking at|see(?:ing)?|in front of|this|that|these|those|here|holding|pointing|where am i|where are we|(?:what|which) (?:place|room|spot))\b/i;

/** True when only the camera photo can answer ("what is this", "where am I"). */
export function isAboutTheView(text: string) {
  return ABOUT_THE_VIEW.test(text);
}

export function isQuestion(text: string) {
  return !NOT_A_QUESTION.test(text);
}
