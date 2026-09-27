import type { ClientId } from './profiles.js'

// Briefs with explicit asks: named styles, music, eras, constraints and
// weather. The first one is the real brief that went wrong on 27-sep-2026.
export const BRIEFS: { id: string; client: ClientId; occasion: string; notes?: string }[] = [
  { id: 'mcqueen-bbq', client: 'coolSummerMan', occasion: 'Casual with friends at a barbecue, i like hard rock music, steve mcqueen style, at summer.' },
  { id: 'metal-concert', client: 'coolSummerMan', occasion: 'Metallica concert in a stadium in November, I want to look cool but not like a teenager' },
  { id: 'beach-formal', client: 'coolSummerMan', occasion: 'Beach wedding in Tulum in July, I am a guest, invitation says beach formal' },
  { id: 'mastroianni-date', client: 'deepAutumnMan', occasion: 'First date at a wine bar in spring, I love old-school Italian style, like a 60s Mastroianni vibe' },
  { id: 'startup-interview', client: 'deepAutumnMan', occasion: 'Job interview at a tech startup in San Francisco', notes: 'I hate ties and suits' },
  { id: 'cabin-winter', client: 'deepAutumnMan', occasion: 'Weekend at a mountain cabin with friends in January, rugged but put together' },
  { id: 'gatsby-party', client: 'deepAutumnMan', occasion: 'Office holiday party in December, the theme is Great Gatsby' },
  { id: 'paris-brunch', client: 'softAutumnWoman', occasion: 'Brunch in Paris in April, I want to look like an effortless French girl' },
  { id: 'eras-concert', client: 'softAutumnWoman', occasion: 'Taylor Swift concert, Eras tour vibe but comfortable, summer night in an outdoor stadium' },
  { id: 'winter-funeral', client: 'softAutumnWoman', occasion: 'Funeral of a colleague in February', notes: 'I only wear pants' },
  { id: 'grunge-party', client: 'deepWinterWoman', occasion: '90s grunge themed birthday party at a bar in October' },
  { id: 'quiet-luxury', client: 'deepWinterWoman', occasion: 'Client presentation at a law firm, I want quiet luxury', notes: 'No heels please' },
  { id: 'garden-wedding', client: 'lightSpringWoman', occasion: 'Garden wedding in June, I love romantic florals but hate pink' },
  { id: 'coachella', client: 'lightSpringWoman', occasion: 'Coachella day two, boho but not costume-y, desert heat' },
]
