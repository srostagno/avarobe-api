// Dressy womenswear looks real clients rated down on 28-30 Sep 2026: the
// garments and their feedback only (no people, no photos). Fixtures for
// dressy-eval.ts.
import type { FeedbackAspect, LookPlan } from "../../src/types/mongo.js";

export const MISSES: {
  id: string;
  occasion: string;
  plan: LookPlan;
  feedback: {
    rating: "down";
    aspects: FeedbackAspect[];
    pieces: { index: number; vote: "up" | "down" }[];
    note: string | null;
  };
}[] = [
  {
    id: "wedding-mauve-satin-cocktail",
    occasion:
      "Wedding guest, invitation says cocktail attire, evening reception",
    plan: {
      title: "Mauve Satin Cocktail",
      vibe: "Polished romantic",
      summary:
        "A mauve satin midi dress with silver accessories and embellished pointed flats gives you cocktail-level polish without heels.",
      whyItWorks:
        "The satin midi length, structured clutch, and crystal flats read dressy enough for an evening cocktail wedding while fully respecting your no-heels request. Mauve is one of your best cool, muted colors near the face, and the defined waist with a softly draped skirt creates elegant proportion on your petite, curvy frame.",
      items: [
        {
          slot: "dress",
          name: "Wrap-front satin midi dress",
          color: "Mauve",
          colorHex: "#A97C8B",
          material: "Satin-back crepe",
          fit: "V-neck, fitted waist, softly A-line midi skirt",
        },
        {
          slot: "layer",
          name: "Sheer evening wrap",
          color: "Cool Gray",
          colorHex: "#A7AAB0",
          material: "Chiffon",
          fit: "Lightweight rectangular wrap",
        },
        {
          slot: "shoes",
          name: "Embellished pointed-toe flats",
          color: "Charcoal",
          colorHex: "#4E5258",
          material: "Suede with crystal trim",
          fit: "Flat sole, pointed toe, secure low-cut vamp",
        },
        {
          slot: "bag",
          name: "Hard-shell evening clutch",
          color: "Soft Navy",
          colorHex: "#3F4E63",
          material: "Satin with silver-tone frame",
          fit: "Small structured handheld clutch",
        },
        {
          slot: "accessory",
          name: "Drop earrings",
          color: "Silver",
          colorHex: "#C0C0C0",
          material: "Sterling silver with clear stones",
          fit: "Delicate short drop",
        },
        {
          slot: "accessory",
          name: "Slim bracelet",
          color: "Silver",
          colorHex: "#C0C0C0",
          material: "Sterling silver",
          fit: "Fine, close-fitting chain",
        },
      ],
      stylingTips: [
        "Choose a midi hem that hits just below the knee to mid-calf so the flats still feel sleek and intentional.",
        "Keep the wrap draped over your shoulders during the reception entrance, then remove it for dancing.",
        "A small pointed flat looks dressier than a ballet flat and visually lengthens the leg without adding heel height.",
      ],
    },
    feedback: {
      rating: "down",
      aspects: ["style"],
      pieces: [
        {
          index: 1,
          vote: "down",
        },
      ],
      note: null,
    },
  },
  {
    id: "wedding-petrol-satin-ease",
    occasion:
      "Wedding guest, invitation says cocktail attire, evening reception",
    plan: {
      title: "Petrol Satin Ease",
      vibe: "Elegant",
      summary:
        "A muted petrol satin midi dress with a cropped taupe wrap, pointed embellished flats, and warm metallic accessories gives you cocktail polish while keeping your shoulders covered and your feet comfortable.",
      whyItWorks:
        "The satin midi length, refined wrap, evening clutch, and jewelry meet cocktail attire for an evening wedding, while the pointed flats honor your no-heels request and still look dressy. Muted petrol near your face flatters your Soft Autumn coloring, and the softly defined waist with an A-line skirt creates an elegant, balanced line on your petite frame.",
      items: [
        {
          slot: "dress",
          name: "Satin wrap midi dress",
          color: "Muted petrol",
          colorHex: "#3F6B6D",
          material: "Hammered satin",
          fit: "V-neck, defined wrap waist, softly flared midi skirt",
        },
        {
          slot: "layer",
          name: "Cropped evening wrap",
          color: "Deep taupe",
          colorHex: "#8B6F63",
          material: "Fine silk-blend chiffon",
          fit: "Lightweight, shoulder-covering, cropped at the waist",
        },
        {
          slot: "shoes",
          name: "Pointed-toe embellished flats",
          color: "Soft espresso",
          colorHex: "#5A4638",
          material: "Suede with tonal bead detail",
          fit: "Flat, pointed toe, secure slingback strap",
        },
        {
          slot: "bag",
          name: "Small envelope clutch",
          color: "Camel",
          colorHex: "#C19A6B",
          material: "Satin",
          fit: "Structured, handheld",
        },
        {
          slot: "accessory",
          name: "Drop earrings",
          color: "Warm gold",
          colorHex: "#C8A24A",
          material: "Brushed metal",
          fit: "Delicate, medium drop",
        },
        {
          slot: "accessory",
          name: "Slim bangle bracelet",
          color: "Warm gold",
          colorHex: "#C8A24A",
          material: "Brushed metal",
          fit: "Minimal, stackable",
        },
      ],
      stylingTips: [
        "Keep the wrap on through the ceremony and reception photos so your shoulders stay covered while the look remains intentional.",
        "Choose flats with a pointed toe and a secure slingback to make them feel evening-appropriate, not casual.",
        "Let the dress and earrings be the focus; skip a necklace so the wrap neckline stays clean.",
      ],
    },
    feedback: {
      rating: "down",
      aspects: [],
      pieces: [
        {
          index: 1,
          vote: "down",
        },
        {
          index: 2,
          vote: "down",
        },
      ],
      note: null,
    },
  },
  {
    id: "wedding-petrol-chiffon-column",
    occasion:
      "Wedding guest, invitation says cocktail attire, evening reception",
    plan: {
      title: "Petrol Chiffon Column",
      vibe: "Elegant",
      summary:
        "A muted petrol satin wrap midi dress is refreshed with a long ivory chiffon duster, comfortable taupe block-heel sandals, and warm metallic accessories for an evening cocktail wedding.",
      whyItWorks:
        "This keeps the cocktail polish of the muted petrol satin dress and warm gold jewelry while replacing the cropped wrap and embellished flats with a fluid, full-length layer and clean block-heel sandals. Muted petrol flatters your Soft Autumn coloring near the face, the wrap waist defines without feeling tight, and the longer ivory layer creates an elongating vertical line on a petite frame.",
      items: [
        {
          slot: "dress",
          name: "Hammered satin wrap midi dress",
          color: "Muted petrol",
          colorHex: "#3F6B6D",
          material: "Hammered satin",
          fit: "V-neck, defined wrap waist, softly flared midi skirt",
        },
        {
          slot: "layer",
          name: "Long sheer evening duster",
          color: "Ivory",
          colorHex: "#F4EBDD",
          material: "Silk-blend chiffon",
          fit: "Open front, wrist-length sleeves, falls below the knee",
        },
        {
          slot: "shoes",
          name: "Ankle-strap block-heel sandals",
          color: "Taupe",
          colorHex: "#8B7A6B",
          material: "Suede",
          fit: "Low block heel, open toe, secure ankle strap",
        },
        {
          slot: "bag",
          name: "Small envelope clutch",
          color: "Camel",
          colorHex: "#C19A6B",
          material: "Satin",
          fit: "Structured, handheld",
        },
        {
          slot: "accessory",
          name: "Drop earrings",
          color: "Warm gold",
          colorHex: "#C9A227",
          material: "Brushed metal",
          fit: "Delicate, medium drop",
        },
        {
          slot: "accessory",
          name: "Slim bangle bracelet",
          color: "Warm gold",
          colorHex: "#C9A227",
          material: "Brushed metal",
          fit: "Minimal, stackable",
        },
      ],
      stylingTips: [
        "Let the ivory duster hang open so the petrol dress stays the focus and the line stays long.",
        "Choose a block heel around 1.5 to 2 inches for reception comfort without using flats.",
        "Keep the jewelry minimal and warm-toned so the satin dress feels evening-ready but not overdone.",
      ],
    },
    feedback: {
      rating: "down",
      aspects: [],
      pieces: [
        {
          index: 0,
          vote: "up",
        },
        {
          index: 1,
          vote: "down",
        },
        {
          index: 2,
          vote: "up",
        },
        {
          index: 3,
          vote: "up",
        },
        {
          index: 4,
          vote: "up",
        },
      ],
      note: null,
    },
  },
  {
    id: "date-petrol-date-dress",
    occasion: "Dinner date at a nice cocktail bar",
    plan: {
      title: "Petrol Date Dress",
      vibe: "Polished romantic",
      summary:
        "A muted petrol wrap-style midi dress with camel block-heel sandals, a camel clutch, and warm gold jewelry gives you an elegant, easy cocktail-bar look.",
      whyItWorks:
        "The muted petrol dress delivers the refined date-night mood while using one of your most flattering Soft Autumn shades close to your face. The wrap-style waist and softly fluid midi skirt create a balanced, comfortable line on your petite frame, while camel accessories keep the outfit warm and cohesive.",
      items: [
        {
          slot: "dress",
          name: "Wrap-style midi dress",
          color: "Muted petrol",
          colorHex: "#3F6B6D",
          material: "Satin-back crepe",
          fit: "V-neck, defined waist, softly fluid A-line midi skirt",
        },
        {
          slot: "shoes",
          name: "Block-heel sandals",
          color: "Camel",
          colorHex: "#C19A6B",
          material: "Suede",
          fit: "Medium block heel with slim ankle strap",
        },
        {
          slot: "bag",
          name: "Small envelope clutch",
          color: "Camel",
          colorHex: "#C19A6B",
          material: "Smooth leather",
          fit: "Structured, hand-held",
        },
        {
          slot: "accessory",
          name: "Delicate hoop earrings",
          color: "Warm gold",
          colorHex: "#B88935",
          material: "Gold-tone metal",
          fit: "Small, rounded hoops",
        },
        {
          slot: "accessory",
          name: "Fine pendant necklace",
          color: "Warm gold",
          colorHex: "#B88935",
          material: "Gold-tone metal",
          fit: "Short delicate chain sitting above the V-neck",
        },
        {
          slot: "accessory",
          name: "Slim cuff bracelet",
          color: "Warm gold",
          colorHex: "#B88935",
          material: "Gold-tone metal",
          fit: "Narrow, gently curved cuff",
        },
      ],
      stylingTips: [
        "Keep the neckline clean with the fine pendant and skip extra layers so the dress stays sleek rather than fussy.",
        "Choose a sandal heel around 2 to 2.5 inches for cocktail polish that still feels good through dinner.",
        "A soft rosy-brown lip and warm bronze eye will echo the Soft Autumn palette without competing with the petrol dress.",
      ],
    },
    feedback: {
      rating: "down",
      aspects: [],
      pieces: [
        {
          index: 0,
          vote: "down",
        },
        {
          index: 1,
          vote: "down",
        },
      ],
      note: null,
    },
  },
  {
    id: "date-rose-satin-column",
    occasion: "Dinner date at a nice cocktail bar",
    plan: {
      title: "Rose Satin Column",
      vibe: "Polished romantic",
      summary:
        "A warm rose satin slip-style midi dress with soft espresso pointed-toe pumps, your camel clutch, and delicate warm gold jewelry gives you a sleek, date-night cocktail look without repeating the wrap dress or sandals.",
      whyItWorks:
        "The bias-cut satin midi and pointed pumps feel elegant and cocktail-bar appropriate, while the silhouette is completely different from the disliked wrap-style dress and the closed-toe pumps avoid anything like camel block-heel sandals. Warm rose flatters your Soft Autumn coloring near the face, and the softly skimming column shape with a V-neck elongates your petite frame without adding fussy layers.",
      items: [
        {
          slot: "dress",
          name: "Satin slip-style midi dress",
          color: "Warm rose",
          colorHex: "#C98B84",
          material: "Satin-back crepe",
          fit: "bias-cut, softly skimming, V-neck, midi length",
        },
        {
          slot: "shoes",
          name: "Pointed-toe pumps",
          color: "Soft espresso",
          colorHex: "#5A4638",
          material: "Suede",
          fit: "low-cut vamp, slim mid heel",
        },
        {
          slot: "bag",
          name: "Small envelope clutch",
          color: "Camel",
          colorHex: "#C19A6B",
          material: "Smooth leather",
          fit: "structured, hand-held",
        },
        {
          slot: "accessory",
          name: "Delicate hoop earrings",
          color: "Warm gold",
          colorHex: "#D4AF37",
          material: "Gold-tone metal",
          fit: "small, rounded hoops",
        },
        {
          slot: "accessory",
          name: "Fine pendant necklace",
          color: "Warm gold",
          colorHex: "#D4AF37",
          material: "Gold-tone metal",
          fit: "short delicate chain sitting above the V-neck",
        },
        {
          slot: "accessory",
          name: "Slim cuff bracelet",
          color: "Warm gold",
          colorHex: "#D4AF37",
          material: "Gold-tone metal",
          fit: "narrow, gently curved cuff",
        },
      ],
      stylingTips: [
        "Keep the necklace short so it sits cleanly above the V-neck and keeps the line polished.",
        "Choose a midi length that hits just below the knee to mid-calf, then add the pointed toe to visually lengthen the leg.",
        "Let the camel clutch be the warm accent; no extra layer is needed for the cocktail-bar setting.",
      ],
    },
    feedback: {
      rating: "down",
      aspects: [],
      pieces: [],
      note: "Not a dress",
    },
  },
  {
    id: "date-teal-satin-separates",
    occasion: "Dinner date at a nice cocktail bar",
    plan: {
      title: "Teal Satin Separates",
      vibe: "Polished romantic",
      summary:
        "A muted petrol satin cowl-neck camisole with deep taupe tailored trousers, soft espresso pumps, a camel clutch, and warm gold jewelry gives you cocktail polish without a dress.",
      whyItWorks:
        "This fixes the brief directly by replacing the dress with elevated separates while keeping the sleek satin mood, pointed pumps, camel clutch, and warm gold jewelry that suit a nice cocktail bar. Muted petrol flatters your Soft Autumn coloring near the face, while the high-rise deep taupe trousers create an elegant, lengthening line on your petite frame.",
      items: [
        {
          slot: "top",
          name: "Satin cowl-neck camisole",
          color: "Muted petrol",
          colorHex: "#3F6B6D",
          material: "Satin-back crepe",
          fit: "softly draped, hip-length",
        },
        {
          slot: "bottom",
          name: "Tailored tapered trousers",
          color: "Deep taupe",
          colorHex: "#8B6F63",
          material: "Stretch wool-blend crepe",
          fit: "high-rise, slim tapered, ankle length",
        },
        {
          slot: "shoes",
          name: "Pointed-toe pumps",
          color: "Soft espresso",
          colorHex: "#5A4638",
          material: "Suede",
          fit: "low-cut vamp, slim mid heel",
        },
        {
          slot: "bag",
          name: "Small envelope clutch",
          color: "Camel",
          colorHex: "#C19A6B",
          material: "Smooth leather",
          fit: "structured, hand-held",
        },
        {
          slot: "accessory",
          name: "Delicate hoop earrings",
          color: "Warm gold",
          colorHex: "#D4AF37",
          material: "Gold-tone metal",
          fit: "small, rounded hoops",
        },
        {
          slot: "accessory",
          name: "Fine pendant necklace",
          color: "Warm gold",
          colorHex: "#D4AF37",
          material: "Gold-tone metal",
          fit: "short delicate chain sitting above the cowl",
        },
        {
          slot: "accessory",
          name: "Slim cuff bracelet",
          color: "Warm gold",
          colorHex: "#D4AF37",
          material: "Gold-tone metal",
          fit: "narrow, gently curved cuff",
        },
      ],
      stylingTips: [
        "Do a soft front tuck only if the camisole has enough length; otherwise let it drape cleanly over the waistband.",
        "Keep the pendant short so it sits above the cowl and doesn’t compete with the neckline.",
        "Choose ankle-length trousers that just clear the pumps to keep the line sleek.",
      ],
    },
    feedback: {
      rating: "down",
      aspects: [],
      pieces: [
        {
          index: 0,
          vote: "down",
        },
        {
          index: 2,
          vote: "down",
        },
      ],
      note: "Too business looking and too formal for date night",
    },
  },
  {
    id: "date-coral-satin-ease",
    occasion: "Dinner date at a nice cocktail bar",
    plan: {
      title: "Coral Satin Ease",
      vibe: "Romantic polished",
      summary:
        "A peach-coral satin blouse with ivory wide-leg trousers feels luminous, feminine, and cocktail-bar ready.",
      whyItWorks:
        "The satin, gold jewelry, and small clutch make this feel dressed-up enough for a nice cocktail bar without becoming formal. Peach coral brightens your face beautifully, while the high-rise wide-leg trouser creates a long, smooth line that balances the soft drape of the blouse.",
      items: [
        {
          slot: "top",
          name: "Satin wrap blouse",
          color: "Peach Coral",
          colorHex: "#FF8A73",
          material: "Silk-blend satin",
          fit: "wrap front, softly fitted waist, bracelet sleeves",
        },
        {
          slot: "bottom",
          name: "High-rise wide-leg trousers",
          color: "Ivory",
          colorHex: "#FFF6E8",
          material: "Fluid crepe",
          fit: "tailored waist, relaxed wide leg",
        },
        {
          slot: "shoes",
          name: "Block-heel sandals",
          color: "Light Camel",
          colorHex: "#D8B07A",
          material: "Suede",
          fit: "open toe, ankle strap, mid heel",
        },
        {
          slot: "bag",
          name: "Small envelope clutch",
          color: "Warm Beige",
          colorHex: "#DCC3A1",
          material: "Smooth leather",
          fit: "structured, handheld",
        },
        {
          slot: "accessory",
          name: "Delicate hoop earrings",
          color: "Gold",
          colorHex: "#D4AF37",
          material: "Gold-tone metal",
          fit: "small, rounded hoops",
        },
        {
          slot: "accessory",
          name: "Slim cuff bracelet",
          color: "Gold",
          colorHex: "#D4AF37",
          material: "Gold-tone metal",
          fit: "minimal, adjustable",
        },
      ],
      stylingTips: [
        "Tuck only the front of the blouse if you want a more relaxed waistline.",
        "Choose a warm peach or coral lip to echo the blouse.",
        "Keep the trouser hem just above the floor with your heels for the longest line.",
      ],
    },
    feedback: {
      rating: "down",
      aspects: ["style", "colors"],
      pieces: [],
      note: null,
    },
  },
  {
    id: "wedding-apricot-satin-midi",
    occasion:
      "Wedding guest, invitation says cocktail attire, evening reception",
    plan: {
      title: "Apricot Satin Midi",
      vibe: "Romantic polished",
      summary:
        "A warm apricot satin midi dress with gold accents gives you a soft, elegant cocktail look for an evening reception.",
      whyItWorks:
        "The satin midi length and metallic heels are dressy enough for cocktail attire while still feeling joyful and wedding-appropriate. Warm apricot near your face lights up a Light Spring palette, and the softly defined waist with an A-line skirt creates an easy, graceful line on your slim build.",
      items: [
        {
          slot: "dress",
          name: "Satin wrap midi dress",
          color: "Warm Apricot",
          colorHex: "#F6B26B",
          material: "Satin-back crepe",
          fit: "defined waist, softly A-line midi",
        },
        {
          slot: "shoes",
          name: "Strappy block-heel sandals",
          color: "Soft Gold",
          colorHex: "#D4AF37",
          material: "Metallic leather",
          fit: "delicate straps, mid block heel",
        },
        {
          slot: "bag",
          name: "Envelope clutch",
          color: "Ivory",
          colorHex: "#FFF6E8",
          material: "Satin",
          fit: "small structured handheld",
        },
        {
          slot: "accessory",
          name: "Drop earrings",
          color: "Gold",
          colorHex: "#D4AF37",
          material: "Polished metal with pearl accents",
          fit: "slim shoulder-grazing length",
        },
        {
          slot: "accessory",
          name: "Fine bracelet",
          color: "Gold",
          colorHex: "#D4AF37",
          material: "Polished metal",
          fit: "delicate chain",
        },
      ],
      stylingTips: [
        "Keep the wrap neckline secured with fashion tape so you can move and dance comfortably.",
        "Choose a soft peach lip and warm champagne eye shimmer to echo the dress without competing with it.",
        "If the room is cool, carry an ivory pashmina rather than adding a dark jacket.",
      ],
    },
    feedback: {
      rating: "down",
      aspects: ["style"],
      pieces: [
        {
          index: 0,
          vote: "down",
        },
        {
          index: 1,
          vote: "down",
        },
        {
          index: 2,
          vote: "down",
        },
      ],
      note: null,
    },
  },
];
