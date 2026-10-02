// Womenswear looks real clients rated down: the garments and their feedback
// only (no people, no photos). Fixtures for dressy-eval.ts.
// - 28-30 Sep 2026: dressy occasions (a cocktail wedding, a cocktail-bar date).
// - 1-2 Oct 2026: fix chains, where each fix of a look rated down was rated
//   down again (a cocktail wedding, everyday boho, the office), plus single
//   misses with words ("I look frumpy", the length of the pants). A chain case
//   fixes one step with every earlier step and its feedback as history, the
//   way the app sees it.
import type { FeedbackAspect, LookPlan } from "../../src/types/mongo.js";
import type { ClientId } from "./profiles.js";

export type MissStep = {
  plan: LookPlan;
  feedback: {
    rating: "down";
    aspects: FeedbackAspect[];
    pieces: { index: number; vote: "up" | "down" }[];
    note: string | null;
  };
};

type Pattern = { label: string; pattern: RegExp; field?: "color" | "garment" };

// Hard constraints a fix must meet, checked by code (dressy-eval.ts). They
// come from the client's own words across the chain, plus "no outer layer
// she didn't ask for" on dressy evenings with no cold weather stated.
export type MissChecks = {
  dress?: boolean; // a dress (not a jumpsuit or separates)
  floorLength?: boolean; // the dress reaches the floor
  noSlit?: boolean;
  noOuterLayer?: boolean; // no jacket, blazer, coat, cardigan, wrap or other cover-up
  noDress?: boolean;
  fullLengthPants?: boolean; // no ankle or cropped trousers
  notOffice?: boolean;
  must?: Pattern[];
  avoid?: Pattern[];
  moreSaturated?: boolean; // clearer colors than the look she called too soft
  colorAbove?: { label: string; pattern: RegExp; hex: string }; // that color, clearer than this hex
};

export type Miss = MissStep & {
  id: string;
  occasion: string;
  notes?: string;
  client?: ClientId;
  // Earlier looks for the same occasion and her feedback on each, oldest first.
  history?: MissStep[];
  checks?: MissChecks;
};

const WEDDING_CHAIN: MissStep[] = [
  {
    "plan": {
      "title": "Berry Satin Column",
      "vibe": "Elegant",
      "summary": "A cool berry square-neck satin midi dress with silver accessories creates a sleek, romantic cocktail look.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "dress",
          "name": "Square-neck satin midi dress",
          "color": "Cool Berry",
          "colorHex": "#9B4F6A",
          "material": "Satin-back crepe",
          "fit": "shaped through the bodice, softly skimming column skirt"
        },
        {
          "slot": "shoes",
          "name": "Strappy heeled sandals",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Metallic leather",
          "fit": "slender straps, mid heel"
        },
        {
          "slot": "bag",
          "name": "Small hard-case clutch",
          "color": "Blue Gray",
          "colorHex": "#7A8896",
          "material": "Satin",
          "fit": "compact handheld shape"
        },
        {
          "slot": "accessory",
          "name": "Drop earrings",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Polished silver-tone metal with clear stones",
          "fit": "delicate shoulder-grazing length"
        },
        {
          "slot": "accessory",
          "name": "Slim evening bracelet",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Polished silver-tone metal",
          "fit": "narrow flexible band"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "style"
      ],
      "pieces": [],
      "note": "I think i am more of a nuetral soft summer palette and was thinking floor length and something to draw attention to a smaller waist but moves somewhat flowy on legs so there is no slit but I can move"
    }
  },
  {
    "plan": {
      "title": "Slate Flow Jumpsuit",
      "vibe": "Softly polished",
      "summary": "A slate blue crepe wide-leg jumpsuit with a defined waist gives you the floor-length movement you wanted without using a dress or a slit.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Crepe wrap-front wide-leg jumpsuit",
          "color": "Slate Blue",
          "colorHex": "#6E83A8",
          "material": "matte stretch crepe",
          "fit": "surplice bodice, set-in waistband, full-length flowing wide leg"
        },
        {
          "slot": "layer",
          "name": "Longline tuxedo blazer",
          "color": "Soft Navy",
          "colorHex": "#2F3E57",
          "material": "lightweight crepe with satin lapel",
          "fit": "open-front, gently shaped waist, hip-skimming length"
        },
        {
          "slot": "shoes",
          "name": "Pointed-toe slingback pumps",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "metallic leather",
          "fit": "low-to-mid heel, pointed toe, open slingback"
        },
        {
          "slot": "bag",
          "name": "Pleated satin evening clutch",
          "color": "Blue Gray",
          "colorHex": "#7A8896",
          "material": "satin",
          "fit": "small structured handheld clutch"
        },
        {
          "slot": "accessory",
          "name": "Linear drop earrings",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "polished silver-tone metal with clear stones",
          "fit": "slim vertical drop"
        },
        {
          "slot": "accessory",
          "name": "Slim waist belt",
          "color": "Blue Gray",
          "colorHex": "#7A8896",
          "material": "suede",
          "fit": "narrow belt worn at the natural waist"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [],
      "pieces": [],
      "note": "I want a dress"
    }
  },
  {
    "plan": {
      "title": "Periwinkle Column",
      "vibe": "Graceful polish",
      "summary": "A periwinkle chiffon A-line gown with a defined waist brings soft, floor-length movement without a slit, finished with silver evening shoes and a cool navy clutch.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "dress",
          "name": "Chiffon A-line gown",
          "color": "Periwinkle",
          "colorHex": "#A9B7E8",
          "material": "Layered chiffon over smooth lining",
          "fit": "V-neck bodice, defined waistband, floor-length A-line skirt, no slit"
        },
        {
          "slot": "outerwear",
          "name": "Single-breasted evening coat",
          "color": "Soft Navy",
          "colorHex": "#2F3E57",
          "material": "Lightweight wool-blend crepe",
          "fit": "Tailored through the shoulders, gently shaped waist, knee length"
        },
        {
          "slot": "shoes",
          "name": "Pointed-toe d'Orsay pumps",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Metallic leather",
          "fit": "Low-to-mid heel, open side, pointed toe"
        },
        {
          "slot": "bag",
          "name": "Box evening clutch",
          "color": "Blue Gray",
          "colorHex": "#7F95A8",
          "material": "Satin",
          "fit": "Small structured handheld clutch"
        },
        {
          "slot": "accessory",
          "name": "Linear drop earrings",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Silver-tone metal with clear stones",
          "fit": "Slim vertical drop"
        },
        {
          "slot": "accessory",
          "name": "Slim evening bracelet",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Polished silver-tone metal",
          "fit": "Delicate, close-fitting cuff"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [],
      "pieces": [],
      "note": "Horrible! I want an off shoulder velvet dress bunched at waist and slightly flowy"
    }
  },
  {
    "plan": {
      "title": "Mauve Velvet Romance",
      "vibe": "Romantic polish",
      "summary": "A muted mauve off-shoulder velvet dress with waist gathering and a softly flowing skirt gives you the exact romantic movement you asked for, finished with silver heels and cool-toned evening accessories.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "dress",
          "name": "Off-shoulder velvet cocktail dress",
          "color": "Muted mauve",
          "colorHex": "#B58AA5",
          "material": "Stretch velvet",
          "fit": "Off-shoulder neckline, gathered bunched waist, softly flowy A-line midi-to-ankle skirt, no slit"
        },
        {
          "slot": "outerwear",
          "name": "Tailored evening coat",
          "color": "Soft navy",
          "colorHex": "#2F3E57",
          "material": "Wool-blend crepe",
          "fit": "Clean single-breasted cut, gently shaped waist, knee length"
        },
        {
          "slot": "shoes",
          "name": "Pointed-toe slingback pumps",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Metallic leather",
          "fit": "Low-to-mid heel, pointed toe, secure slingback strap"
        },
        {
          "slot": "bag",
          "name": "Structured evening clutch",
          "color": "Blue gray",
          "colorHex": "#7F95A8",
          "material": "Satin",
          "fit": "Small handheld box shape"
        },
        {
          "slot": "accessory",
          "name": "Slim crystal drop earrings",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Silver-tone metal with clear stones",
          "fit": "Delicate vertical drop"
        },
        {
          "slot": "accessory",
          "name": "Delicate evening cuff",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Polished silver-tone metal",
          "fit": "Slim close-fitting cuff"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [],
      "pieces": [],
      "note": "Full length no mauve no jacket"
    }
  }
]

const BOHO_CHAIN: MissStep[] = [
  {
    "plan": {
      "title": "Sage Folk Ease",
      "vibe": "Earthy ease",
      "summary": "A peasant blouse, wide-leg denim, and a crochet vest create a soft everyday bohemian outfit with comfortable structure.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Embroidered peasant blouse",
          "color": "Deep Sage",
          "colorHex": "#7E8B73",
          "material": "Cotton voile",
          "fit": "relaxed, slightly blouson"
        },
        {
          "slot": "layer",
          "name": "Crochet vest",
          "color": "Oatmeal",
          "colorHex": "#D8C8B0",
          "material": "Cotton crochet",
          "fit": "open front, hip length"
        },
        {
          "slot": "bottom",
          "name": "High-rise wide-leg jeans",
          "color": "Medium warm blue denim",
          "colorHex": "#5F7180",
          "material": "Cotton denim with slight stretch",
          "fit": "high-rise, full-length wide leg"
        },
        {
          "slot": "shoes",
          "name": "Suede ankle boots",
          "color": "Olive Brown",
          "colorHex": "#6E5B3E",
          "material": "Suede",
          "fit": "low stacked heel, almond toe"
        },
        {
          "slot": "bag",
          "name": "Woven crossbody bag",
          "color": "Warm Beige",
          "colorHex": "#CBB79B",
          "material": "Woven straw with leather trim",
          "fit": "small, structured crossbody"
        },
        {
          "slot": "accessory",
          "name": "Hammered hoop earrings",
          "color": "Antique gold",
          "colorHex": "#B08D57",
          "material": "Gold-tone metal",
          "fit": "medium hoop"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "style",
        "missed_request",
        "colors"
      ],
      "pieces": [
        {
          "index": 0,
          "vote": "down"
        },
        {
          "index": 2,
          "vote": "down"
        },
        {
          "index": 3,
          "vote": "up"
        },
        {
          "index": 5,
          "vote": "up"
        },
        {
          "index": 1,
          "vote": "up"
        }
      ],
      "note": "I don't look good in sage green its too muted. I love peasant blouses"
    }
  },
  {
    "plan": {
      "title": "Textured Olive Boho",
      "vibe": "Earthy textured",
      "summary": "A soft terracotta ribbed tee, oatmeal crochet vest, and dusty olive utility midi skirt create an easy bohemian outfit without the rejected peasant blouse or blue wide-leg denim.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Ribbed crewneck tee",
          "color": "Soft Terracotta",
          "colorHex": "#C46A4A",
          "material": "Cotton-modal rib knit",
          "fit": "fitted but not tight, hip length"
        },
        {
          "slot": "layer",
          "name": "Crochet vest",
          "color": "Oatmeal",
          "colorHex": "#D8C8B0",
          "material": "Cotton crochet",
          "fit": "open front, hip length"
        },
        {
          "slot": "bottom",
          "name": "Utility midi skirt",
          "color": "Dusty Olive",
          "colorHex": "#7A8452",
          "material": "Washed cotton twill",
          "fit": "high-rise, A-line, below-knee length"
        },
        {
          "slot": "shoes",
          "name": "Suede ankle boots",
          "color": "Olive Brown",
          "colorHex": "#6E5B3E",
          "material": "Suede",
          "fit": "low stacked heel, almond toe"
        },
        {
          "slot": "bag",
          "name": "Slouchy crescent crossbody bag",
          "color": "Chocolate Brown",
          "colorHex": "#5A4636",
          "material": "Soft pebbled leather",
          "fit": "small to medium, close-to-body strap"
        },
        {
          "slot": "accessory",
          "name": "Hammered hoop earrings",
          "color": "Antique Gold",
          "colorHex": "#B08D57",
          "material": "Gold-tone metal",
          "fit": "medium hoop"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "style"
      ],
      "pieces": [],
      "note": "I hate jean skirts, I also don't look good in crew neck shirts."
    }
  },
  {
    "plan": {
      "title": "Terracotta Boho Ease",
      "vibe": "Earthy bohemian",
      "summary": "A soft terracotta V-neck peasant blouse, oatmeal crochet vest, and olive-brown linen-blend pants make the outfit feel bohemian without using a jean skirt or a crew neck.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "V-neck peasant blouse",
          "color": "Soft Terracotta",
          "colorHex": "#C46A4A",
          "material": "cotton gauze",
          "fit": "relaxed, gently gathered, hip length"
        },
        {
          "slot": "layer",
          "name": "Open-front crochet vest",
          "color": "Oatmeal",
          "colorHex": "#D8C8B0",
          "material": "cotton crochet",
          "fit": "straight, hip length"
        },
        {
          "slot": "bottom",
          "name": "Pull-on tapered pants",
          "color": "Olive Brown",
          "colorHex": "#6E5B3E",
          "material": "linen-viscose blend",
          "fit": "high-rise, relaxed through the hip, tapered ankle"
        },
        {
          "slot": "shoes",
          "name": "Suede ankle boots",
          "color": "Chocolate Brown",
          "colorHex": "#5A4636",
          "material": "suede",
          "fit": "low stacked heel, almond toe"
        },
        {
          "slot": "bag",
          "name": "Woven crescent crossbody bag",
          "color": "Warm Taupe",
          "colorHex": "#A28C7A",
          "material": "woven raffia with faux leather trim",
          "fit": "small to medium, close-to-body strap"
        },
        {
          "slot": "accessory",
          "name": "Hammered hoop earrings",
          "color": "Antique Gold",
          "colorHex": "#B08D57",
          "material": "gold-tone metal",
          "fit": "medium hoop"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "colors"
      ],
      "pieces": [],
      "note": "The colors are just a LITTLE too soft for me. The photo colors are different from the labeled colors. The labeled colors are great, the photo colors are softened."
    }
  },
  {
    "plan": {
      "title": "Moss Boho Texture",
      "vibe": "Earthy depth",
      "summary": "A moss green embroidered peasant tunic, camel crochet vest, olive brown corduroy bootcuts, and chocolate suede ankle boots make the bohemian formula feel richer and clearer.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Embroidered V-neck peasant tunic",
          "color": "Moss Green",
          "colorHex": "#6B7B4A",
          "material": "cotton slub with tonal embroidery",
          "fit": "relaxed, V-neck, gently bloused sleeve, high-hip length"
        },
        {
          "slot": "layer",
          "name": "Open-front longline crochet vest",
          "color": "Camel",
          "colorHex": "#C19A6B",
          "material": "cotton crochet knit",
          "fit": "straight, open front, mid-hip length"
        },
        {
          "slot": "bottom",
          "name": "Pull-on bootcut corduroy pants",
          "color": "Olive Brown",
          "colorHex": "#6E5B3E",
          "material": "fine-wale stretch cotton corduroy",
          "fit": "high-rise, fitted through hip and thigh, subtle bootcut"
        },
        {
          "slot": "shoes",
          "name": "Suede ankle boots",
          "color": "Chocolate Brown",
          "colorHex": "#5A4636",
          "material": "suede",
          "fit": "almond toe, low stacked heel, ankle height"
        },
        {
          "slot": "bag",
          "name": "Tooled crossbody saddle bag",
          "color": "Warm Taupe",
          "colorHex": "#A28C7A",
          "material": "faux leather with embossed tooling",
          "fit": "small to medium, adjustable crossbody strap"
        },
        {
          "slot": "accessory",
          "name": "Hammered hoop earrings",
          "color": "Antique Gold",
          "colorHex": "#B08D57",
          "material": "gold-tone metal",
          "fit": "medium hoop"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "colors"
      ],
      "pieces": [],
      "note": "They stule was okay im not a big overly boot cut fan. There's a lot of different saturation greens. Terra cotta was good but a little more saturation on terrain cotta"
    }
  }
]

const OFFICE_CHAIN: MissStep[] = [
  {
    "plan": {
      "title": "Sage Soft Tailoring",
      "vibe": "Polished",
      "summary": "A warm sage knit shell, mushroom tapered trousers, and a camel blazer create a soft, professional office look with easy structure.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Fine-gauge knit shell",
          "color": "Warm Sage",
          "colorHex": "#9AA88A",
          "material": "Merino-cotton blend knit",
          "fit": "slim, smooth fit"
        },
        {
          "slot": "layer",
          "name": "Single-breasted blazer",
          "color": "Camel",
          "colorHex": "#C19A6B",
          "material": "Stretch twill",
          "fit": "tailored, hip length"
        },
        {
          "slot": "bottom",
          "name": "Tapered ankle trousers",
          "color": "Mushroom",
          "colorHex": "#9B8B80",
          "material": "Stretch wool-blend suiting",
          "fit": "mid-rise, slim tapered"
        },
        {
          "slot": "shoes",
          "name": "Pointed-toe loafers",
          "color": "Olive Brown",
          "colorHex": "#6B5E3D",
          "material": "Leather",
          "fit": "flat, structured"
        },
        {
          "slot": "bag",
          "name": "Structured tote",
          "color": "Warm Taupe",
          "colorHex": "#A58A7A",
          "material": "Pebbled leather",
          "fit": "medium size"
        },
        {
          "slot": "accessory",
          "name": "Small hoop earrings",
          "color": "Gold",
          "colorHex": "#D4AF37",
          "material": "Gold-tone metal",
          "fit": "delicate"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "style",
        "colors"
      ],
      "pieces": [
        {
          "index": 2,
          "vote": "down"
        },
        {
          "index": 5,
          "vote": "down"
        },
        {
          "index": 1,
          "vote": "down"
        },
        {
          "index": 0,
          "vote": "down"
        }
      ],
      "note": null
    }
  },
  {
    "plan": {
      "title": "Teal Column Knit",
      "vibe": "Polished modern",
      "summary": "A muted teal ribbed mock-neck sweater with a soft navy A-line midi skirt and heeled loafers gives you structure without the sage-shell, blazer-and-trouser formula.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Ribbed mock-neck sweater",
          "color": "Muted Teal",
          "colorHex": "#4F7F7A",
          "material": "cotton-modal knit",
          "fit": "slim, hip length"
        },
        {
          "slot": "layer",
          "name": "Longline open cardigan",
          "color": "Soft Navy",
          "colorHex": "#3F4E5A",
          "material": "fine merino knit",
          "fit": "straight, mid-thigh length"
        },
        {
          "slot": "bottom",
          "name": "A-line midi skirt",
          "color": "Soft Navy",
          "colorHex": "#3F4E5A",
          "material": "stretch ponte knit",
          "fit": "high-rise, gently flared"
        },
        {
          "slot": "shoes",
          "name": "Block-heel loafer pumps",
          "color": "Olive Brown",
          "colorHex": "#6B5E3D",
          "material": "smooth leather",
          "fit": "closed toe, low block heel"
        },
        {
          "slot": "bag",
          "name": "Structured work tote",
          "color": "Warm Taupe",
          "colorHex": "#A58A7A",
          "material": "pebbled leather",
          "fit": "medium size"
        },
        {
          "slot": "accessory",
          "name": "Small stud earrings",
          "color": "Antique Gold",
          "colorHex": "#B08D57",
          "material": "brushed metal",
          "fit": "minimal, round stud"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "style",
        "fit",
        "weather"
      ],
      "pieces": [
        {
          "index": 0,
          "vote": "down"
        },
        {
          "index": 2,
          "vote": "down"
        },
        {
          "index": 3,
          "vote": "down"
        }
      ],
      "note": null
    }
  },
  {
    "plan": {
      "title": "Seafoam Popover",
      "vibe": "Modern clean",
      "summary": "A seafoam gray popover blouse with soft navy straight-leg cotton pants and plum ankle boots gives you a cooler, lighter office look with a cleaner fit.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Popover blouse",
          "color": "Seafoam Gray",
          "colorHex": "#8FAAA2",
          "material": "matte silk-cotton voile",
          "fit": "relaxed through the body, bracelet sleeves, hip length"
        },
        {
          "slot": "bottom",
          "name": "Straight-leg ankle pants",
          "color": "Soft Navy",
          "colorHex": "#3F4E5A",
          "material": "stretch cotton twill",
          "fit": "mid-rise, slim straight leg, ankle length"
        },
        {
          "slot": "shoes",
          "name": "Pointed-toe ankle boots",
          "color": "Dusty Plum",
          "colorHex": "#8D6C7A",
          "material": "suede",
          "fit": "close ankle shaft, low stacked heel"
        },
        {
          "slot": "bag",
          "name": "Structured work satchel",
          "color": "Soft Navy",
          "colorHex": "#3F4E5A",
          "material": "smooth leather",
          "fit": "medium size, top-handle with optional shoulder strap"
        },
        {
          "slot": "accessory",
          "name": "Slim bar stud earrings",
          "color": "Brushed Gold",
          "colorHex": "#B08D57",
          "material": "brushed metal",
          "fit": "small linear studs"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "weather",
        "too_casual"
      ],
      "pieces": [
        {
          "index": 2,
          "vote": "down"
        },
        {
          "index": 4,
          "vote": "down"
        },
        {
          "index": 3,
          "vote": "down"
        }
      ],
      "note": null
    }
  },
  {
    "plan": {
      "title": "Plum Column",
      "vibe": "Sharp polish",
      "summary": "A dusty plum knit shell, charcoal-gray blazer, and soft navy crepe trousers make a sleeker office look with pumps and a structured tote.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Fine-gauge mock-neck knit shell",
          "color": "Dusty Plum",
          "colorHex": "#8D6C7A",
          "material": "viscose-blend knit",
          "fit": "slim, smooth, hip length"
        },
        {
          "slot": "layer",
          "name": "Single-breasted blazer",
          "color": "Charcoal Mushroom",
          "colorHex": "#6F6661",
          "material": "lightweight wool-blend suiting",
          "fit": "sharp shoulders, nipped waist, hip length"
        },
        {
          "slot": "bottom",
          "name": "Straight-leg crepe trousers",
          "color": "Soft Navy",
          "colorHex": "#3F4E5A",
          "material": "stretch crepe",
          "fit": "mid-rise, tailored straight leg, full length"
        },
        {
          "slot": "shoes",
          "name": "Pointed-toe pumps",
          "color": "Deep Pewter",
          "colorHex": "#55585C",
          "material": "smooth leather",
          "fit": "closed toe, low block heel"
        },
        {
          "slot": "bag",
          "name": "Structured work tote",
          "color": "Charcoal Gray",
          "colorHex": "#4E5052",
          "material": "pebbled leather",
          "fit": "medium-large, top-handle with shoulder straps"
        },
        {
          "slot": "accessory",
          "name": "Small pearl stud earrings",
          "color": "Soft Ivory",
          "colorHex": "#F1E6D6",
          "material": "freshwater pearl",
          "fit": "small round studs"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "weather",
        "style"
      ],
      "pieces": [
        {
          "index": 0,
          "vote": "down"
        },
        {
          "index": 3,
          "vote": "down"
        }
      ],
      "note": "All these look pretty grandma even for work"
    }
  }
]

const OFFICE_FRUMPY: MissStep[] = [
  {
    "plan": {
      "title": "Periwinkle Polish",
      "vibe": "Soft tailored",
      "summary": "A soft periwinkle blouse with mushroom ankle trousers and pewter loafers creates an easy, polished office look.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Drape-neck blouse",
          "color": "Soft periwinkle",
          "colorHex": "#A7B3D6",
          "material": "Washed crepe",
          "fit": "relaxed, softly tucked"
        },
        {
          "slot": "layer",
          "name": "Fine-gauge cardigan",
          "color": "Soft navy",
          "colorHex": "#4E5D73",
          "material": "Merino blend knit",
          "fit": "slim, hip-length"
        },
        {
          "slot": "bottom",
          "name": "Ankle trousers",
          "color": "Mushroom taupe",
          "colorHex": "#8B7F73",
          "material": "Stretch woven twill",
          "fit": "mid-rise, straight-leg, cropped at the ankle"
        },
        {
          "slot": "shoes",
          "name": "Penny loafers",
          "color": "Pewter",
          "colorHex": "#7A7B80",
          "material": "Polished leather",
          "fit": "low-profile, almond-toe"
        },
        {
          "slot": "bag",
          "name": "Structured work tote",
          "color": "Blue gray charcoal",
          "colorHex": "#545A61",
          "material": "Pebbled leather",
          "fit": "medium, top-handle"
        },
        {
          "slot": "accessory",
          "name": "Small hoop earrings",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Sterling silver",
          "fit": "small, rounded"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [
        "colors"
      ],
      "pieces": [
        {
          "index": 0,
          "vote": "down"
        },
        {
          "index": 3,
          "vote": "down"
        },
        {
          "index": 4,
          "vote": "down"
        }
      ],
      "note": "don't like the color or drape. I look frumpy"
    }
  }
]

const DATE_PANTS: MissStep[] = [
  {
    "plan": {
      "title": "Cobalt Night",
      "vibe": "Polished",
      "summary": "A cobalt camp-collar shirt with black pleated trousers and sleek loafers gives you a crisp, cool-toned cocktail-bar look that stays breathable.",
      "whyItWorks": "",
      "items": [
        {
          "slot": "top",
          "name": "Camp-collar button-up shirt",
          "color": "Cobalt blue",
          "colorHex": "#0047AB",
          "material": "Lightweight silk-cotton blend",
          "fit": "relaxed, straight"
        },
        {
          "slot": "bottom",
          "name": "Pleated dress trousers",
          "color": "Black",
          "colorHex": "#000000",
          "material": "Lightweight tropical wool blend",
          "fit": "high-rise, straight-leg, ankle-length"
        },
        {
          "slot": "shoes",
          "name": "Penny loafers",
          "color": "Black",
          "colorHex": "#000000",
          "material": "Polished leather",
          "fit": "sleek, low-profile"
        },
        {
          "slot": "accessory",
          "name": "Slim chain necklace",
          "color": "Silver",
          "colorHex": "#C0C0C0",
          "material": "Sterling silver",
          "fit": "short, close to the collarbone"
        },
        {
          "slot": "accessory",
          "name": "Leather belt",
          "color": "Black",
          "colorHex": "#000000",
          "material": "Smooth leather",
          "fit": "narrow, clean buckle"
        },
        {
          "slot": "bag",
          "name": "Small crossbody bag",
          "color": "Charcoal",
          "colorHex": "#333739",
          "material": "Pebbled leather",
          "fit": "compact, structured"
        }
      ],
      "stylingTips": []
    },
    "feedback": {
      "rating": "down",
      "aspects": [],
      "pieces": [
        {
          "index": 5,
          "vote": "down"
        },
        {
          "index": 2,
          "vote": "down"
        },
        {
          "index": 1,
          "vote": "down"
        }
      ],
      "note": "Dont like the length of the pants"
    }
  }
]

const COCKTAIL_WEDDING = "Wedding guest, invitation says cocktail attire, evening reception";
const OFFICE = "Regular day at an office with a business casual dress code";

const floorDress = { dress: true, floorLength: true, noSlit: true, noOuterLayer: true };
const peasant = { label: "a peasant blouse", pattern: /peasant/i, field: "garment" as const };
const noSage = { label: "no sage", pattern: /sage/i, field: "color" as const };
const noCrewNeck = { label: "no crew neck", pattern: /crew[- ]?neck/i, field: "garment" as const };
const noJeanSkirt = { label: "no jean skirt", pattern: /(denim|jean)[^;]*skirt|skirt[^;]*(denim|jean)/i, field: "garment" as const };

// Each step of a chain, fixed with every earlier step as history.
function chain(
  prefix: string,
  occasion: string,
  steps: MissStep[],
  checks: MissChecks[],
  extra: Partial<Miss> = {},
): Miss[] {
  return steps.map((step, index) => ({
    id: `${prefix}-${index + 1}`,
    occasion,
    ...extra,
    ...step,
    history: steps.slice(0, index),
    checks: checks[index],
  }));
}

const CHAIN_CASES: Miss[] = [
  // A cocktail wedding, 2 Oct: four thumbs down in a row. She asked for a
  // floor-length, flowy dress with a defined waist and no slit in a soft
  // summer palette, and got a jumpsuit with a tuxedo blazer, a chiffon gown
  // with a coat, then the velvet off-shoulder dress she asked for, but midi,
  // mauve and with a coat again. Step 1 has to keep the dress (she criticized
  // its palette and length, not that it was a dress).
  ...chain(
    "wedding-chain",
    COCKTAIL_WEDDING,
    WEDDING_CHAIN,
    [
      floorDress,
      floorDress,
      {
        ...floorDress,
        must: [
          { label: "velvet", pattern: /velvet/i, field: "garment" },
          { label: "off-shoulder", pattern: /off[- ]the[- ]shoulder|off[- ]shoulder|bardot/i, field: "garment" },
        ],
      },
      {
        ...floorDress,
        must: [
          { label: "velvet", pattern: /velvet/i, field: "garment" },
          { label: "off-shoulder", pattern: /off[- ]the[- ]shoulder|off[- ]shoulder|bardot/i, field: "garment" },
        ],
        avoid: [{ label: "no mauve", pattern: /mauve/i, field: "color" }],
      },
    ],
    { client: "softSummerWoman" },
  ),
  // Everyday boho, 1 Oct: "sage is too muted, I love peasant blouses" got a
  // crew-neck tee and a twill skirt; then the colors were too soft (and the
  // photo softer than the labeled colors); then bootcuts and a greener palette.
  ...chain("boho-chain", "Everyday bohemian", BOHO_CHAIN, [
    { must: [peasant], avoid: [noSage], moreSaturated: true },
    { must: [peasant], avoid: [noSage, noCrewNeck, noJeanSkirt] },
    { must: [peasant], avoid: [noSage, noCrewNeck, noJeanSkirt], moreSaturated: true },
    {
      must: [peasant, { label: "terracotta", pattern: /terra ?cotta/i, field: "color" }],
      avoid: [noSage, noCrewNeck, noJeanSkirt, { label: "no bootcut", pattern: /boot[- ]?cut/i, field: "garment" }],
      colorAbove: { label: "a clearer terracotta", pattern: /terra ?cotta/i, hex: "#C46A4A" },
    },
  ]),
  // The office, 1 Oct: three fixes rated down, the last one "pretty grandma
  // even for work". Only the last step is a case: the earlier ones have no words.
  {
    id: "office-chain-grandma",
    occasion: OFFICE,
    ...OFFICE_CHAIN[3]!,
    history: OFFICE_CHAIN.slice(0, 3),
    checks: {},
  },
  {
    id: "office-frumpy-periwinkle",
    occasion: OFFICE,
    client: "softSummerWoman",
    ...OFFICE_FRUMPY[0]!,
    checks: {
      avoid: [
        { label: "not the periwinkle again", pattern: /periwinkle/i, field: "color" },
        { label: "no drape neck", pattern: /drape/i, field: "garment" },
      ],
    },
  },
  {
    id: "date-pants-length",
    occasion: "Dinner date at a nice cocktail bar",
    notes: "Hot weather",
    client: "deepWinterWoman",
    ...DATE_PANTS[0]!,
    checks: { fullLengthPants: true, notOffice: true, noOuterLayer: true },
  },
];

export const MISSES: Miss[] = [
  {
    id: "wedding-mauve-satin-cocktail",
    checks: { noOuterLayer: true },
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
    checks: { noOuterLayer: true },
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
    checks: { noOuterLayer: true },
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
    checks: { noOuterLayer: true },
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
    checks: { noOuterLayer: true, noDress: true },
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
    checks: { noOuterLayer: true, notOffice: true },
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
    checks: { noOuterLayer: true },
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
    checks: { noOuterLayer: true },
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
  ...CHAIN_CASES,
];
