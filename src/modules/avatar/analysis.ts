import type { ColorAnalysis, ColorSwatch } from '../../types/mongo.js'

const HEX_PATTERN = /^#[0-9a-f]{6}$/i

// The model now and then slips a word from another script into its English
// ("Warm sunlight is сильнly warming the image"). Latin covers accented
// shade names like "Café au lait"; Common covers digits and punctuation.
const FOREIGN_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

export function hasForeignScript(text: string | null) {
  return text !== null && FOREIGN_SCRIPT.test(text)
}

// Whether any text a person reads in the analysis has a foreign-script slip.
export function analysisHasForeignScript(analysis: ColorAnalysis) {
  return [
    analysis.summary,
    analysis.photoNote,
    ...[...analysis.bestColors, ...analysis.neutrals, ...analysis.avoidColors].map((swatch) => swatch.name),
  ].some(hasForeignScript)
}

function cleanSwatches(swatches: ColorSwatch[], max: number) {
  return swatches
    .filter((swatch) => swatch.name.trim() && HEX_PATTERN.test(swatch.hex) && !hasForeignScript(swatch.name))
    .slice(0, max)
    .map((swatch) => ({ name: swatch.name.trim(), hex: swatch.hex.toUpperCase() }))
}

// Trims the palettes and drops parts that would show garbled text: a
// swatch with a foreign-script name, or a photo note with a slip (the note
// is optional advice, so it is better left out than shown broken).
export function cleanColorAnalysis(analysis: ColorAnalysis): ColorAnalysis {
  return {
    ...analysis,
    bestColors: cleanSwatches(analysis.bestColors, 12),
    neutrals: cleanSwatches(analysis.neutrals, 6),
    avoidColors: cleanSwatches(analysis.avoidColors, 5),
    photoNote: hasForeignScript(analysis.photoNote) ? null : analysis.photoNote,
  }
}
