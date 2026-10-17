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
