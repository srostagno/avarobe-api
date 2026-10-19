// A makeup preset on her: a close beauty portrait of the same woman with only
// the makeup changed. Images: her avatar and her selfie as a close-up of the
// face, or the selfie alone before she has an avatar (colors first).

const WITH_AVATAR = 'Image 1 is this person. Image 2 is a close-up of the same face.'
const SELFIE_ONLY = 'Image 1 is a selfie of this person.'

export function buildMakeupPrompt(input: { name: string; render: string; hasAvatar: boolean }) {
  return [
    input.hasAvatar ? WITH_AVATAR : SELFIE_ONLY,
    'Create a close beauty portrait photo of this SAME person wearing new makeup: identical face shape, facial features, skin tone and undertone, eye color, hair, facial hair and expression, instantly recognisable.',
    `The makeup: ${input.name}. ${input.render}`,
    'Change ONLY the makeup. Their real, mature skin stays real: pores, fine lines, freckles and natural texture stay visible; no smoothing, no reshaping, no slimming, no filter; they keep their age.',
    'Framing: a close portrait from just above the top of the head to the collarbones, facing the camera with the head straight, a soft natural expression, the makeup clearly visible.',
    'They wear a plain oatmeal crew-neck top. Seamless light warm-grey studio backdrop, soft even daylight from the front, realistic beauty photo, no text, no logos.',
  ].join(' ')
}

// "Your best face" (Face Age, Pro; Oct 18, 2026, Silvio picked it from a
// comparison): her read's changes, clearly visible. The makeup prompt keeps
// her hair, expression and an oatmeal top identical, so a read about light,
// a grey top and a serious face came back nearly unchanged; the API's own
// read of it dropped 4 years, but it didn't look like her best day. Here the
// light, the color near her face, her hair's styling and a real smile change
// too; her features, skin and age never do.
export function buildBestFacePrompt(input: { render: string; hasAvatar: boolean; men?: boolean }) {
  const grooming = input.men
    ? 'groomed brows, even fresh-looking skin (no makeup look), hair (and beard, if any) neatly trimmed and styled with the same color and length'
    : 'fresh natural makeup (concealer softening shadows under the eyes, a soft warm blush, defined lashes, groomed brows, a rosy lip), hair freshly washed and styled with soft volume and face-framing pieces (same color and length)'

  return [
    input.hasAvatar ? WITH_AVATAR : SELFIE_ONLY,
    'Create this SAME person on their best day, photographed well: identical face shape, facial features, skin tone and undertone, eye color, hair color and hair length, instantly recognisable.',
    'Their real, mature skin stays real: pores, fine lines, freckles and natural texture stay visible; no smoothing, no reshaping, no slimming, no filter; they keep their age.',
    input.render,
    `What changes, clearly visible but realistic: ${grooming}, a warm genuine smile that lifts the eyes, a soft top in a warm flattering color that lifts the face (not grey, not black, not white), and soft flattering window daylight from the front.`,
    'Framing: a natural phone portrait from just above the top of the head to the upper chest, facing the camera, head straight. A bright, tidy, softly blurred home background. Realistic photo, no text, no logos.',
  ].join(' ')
}

