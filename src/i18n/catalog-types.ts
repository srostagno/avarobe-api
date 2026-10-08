// The try-on catalog (modules/looks/edits.ts and icons.ts) in another
// language, applied when it's served (looks/edit-routes.ts, icon-routes.ts).
// The catalog itself stays English: the image model and the try-on prompts
// read it. Ids, hex codes, slots and images never change; anything missing
// from a table shows in English.
export type CatalogTable = {
  // Every Edit by id, and the 'icons' pseudo-edit.
  edits: Record<string, { name: string; tagline: string }>
  // The announced drops, by their English name.
  upcoming: Record<string, string>
  // Every look (Edits and icons) by id.
  looks: Record<string, { name: string; description: string; era: string; mood: string }>
  // Piece names, colors, materials and fits, by their English text.
  pieces: Record<string, string>
}
