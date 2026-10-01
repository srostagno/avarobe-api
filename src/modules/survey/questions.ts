// The one-tap questions the studio asks, to learn why people come and why
// they pay (or don't). Answers are codes; only "other" carries a short note.
export const SURVEY_QUESTIONS = {
  // While their colors (or avatar) are being made.
  intent: ['colors', 'event', 'shopping', 'haircut', 'curious'],
  // Only after intent = event.
  event_when: ['this_week', 'this_month', 'later'],
  // After closing an offer without paying.
  held_back: ['too_expensive', 'not_sure_accurate', 'season_enough', 'not_here', 'later', 'other'],
  // On the page after paying.
  convinced: ['saw_on_face', 'best_locked', 'looks', 'price', 'haircut', 'other'],
} as const

export type SurveyQuestion = keyof typeof SURVEY_QUESTIONS

// Asked once per person; the others can come up again (another offer
// closed, another purchase), at most once in this window.
export const ONCE_PER_PERSON: SurveyQuestion[] = ['intent', 'event_when']
export const REPEAT_AFTER_MS = 12 * 60 * 60 * 1000
