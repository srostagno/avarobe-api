// The emails' words in American English: the source the other languages
// follow (emails.pt-BR.ts, emails.es.ts share this shape, EmailCopy). Prices
// and dates come in already formatted for the reader (i18n/emails.ts).
// Lifecycle emails: modules/lifecycle/templates.ts; account emails:
// utils/email.ts.

// "Your X is one step away" (checkout rescue).
const PRODUCT_NAMES: Record<string, string> = {
  color_report: 'Color Advisor',
  color_addon: 'Color Advisor',
  style_report: 'Style Advisor',
  style_addon: 'Style Advisor',
  reports_bundle: 'Color and Style Advisors',
  look_pack: 'looks',
  pro_monthly: 'Avarobe Pro',
  pro_annual: 'Avarobe Pro',
  pro_trial: 'Avarobe Pro',
  // Since 2-Oct the mirror comes with the Color Advisor.
  color_mirror: 'Color Advisor',
  hair_advisor: 'Hair & Grooming Advisor',
  advisors_bundle: 'three advisors',
  event_pass: 'Event Stylist',
  // "Your Personal Magazine is one step away".
  magazine: 'Personal Magazine',
}

// Names that read as plural: "Your three advisors are…".
const PLURAL_PRODUCTS = new Set(['look_pack', 'reports_bundle', 'advisors_bundle'])

export const enEmails = {
  // <html lang>.
  lang: 'en',

  names: {
    colorAdvisor: 'Color Advisor',
    styleAdvisor: 'Style Advisor',
    hairAdvisor: 'Hair & Grooming Advisor',
    eventStylist: 'Event Stylist',
    allAdvisors: 'All three advisors',
    pro: 'Avarobe Pro',
    lookPack: 'Look pack',
    book: 'The Outfit Formula Book',
    magazine: 'Your Personal Magazine',
  },

  common: {
    hi: (name: string) => `Hi ${name},`,
    hiThere: 'Hi there,',
    signoff: 'See you inside,',
    team: 'The Avarobe team',
    // Before a tip, and a finished step, in the text part.
    tip: 'Tip',
    doneMark: '[done]',
    yourSeason: 'Your season',
    videoCaption: 'Everything inside, shown on an example',
    whatsInside: 'What’s inside',
    seeWhatsInside: (seconds: number) => `See what’s inside · ${seconds} s`,
    // Under the season card: what they've seen, or what's waiting.
    seenColors: (count: number) =>
      `You’ve seen ${count} of your colors. Your full palette has 30+, with your neutrals and the ones to keep away from your face.`,
    colorsWaiting:
      'Your best colors, your #1 and 30+ more, with your neutrals and the ones to keep away from your face, are in your Color Advisor.',
    selfieTip: 'For the most accurate colors, take your selfie facing a window in daylight, with no filter and little makeup.',
    orPayOnce: 'Or pay once, no subscription:',
    buyNote: 'Opens your checkout, already signed in. Apple Pay, Google Pay or card.',
    onceNote: 'One-time payment, no subscription. Yours to keep.',
    oneTime: 'One-time payment, no subscription.',
    noSubscription: 'No subscription.',
    yoursToKeep: 'Yours to keep.',
    renewalNote: 'Pro renews monthly until you cancel. Cancel anytime in your account settings.',
    notReady: 'Not ready? Your avatar, your season and your looks stay in your account, and you can pick up anytime.',
    manage: (url: string) => `Manage or cancel your plan: ${url}`,
    // Prices: "$4.99, once", "$7.90 once", "$4.90 an event", "$7.99/mo".
    priceOnce: (price: string) => `${price}, once`,
    once: (price: string) => `${price} once`,
    perEvent: (price: string) => `${price} an event`,
    perMonthShort: (price: string) => `${price}/mo`,
    perMonth: (price: string) => `${price} a month`,
    thenPerMonth: (price: string) => `Then ${price} a month.`,
    inPerson: (range: string) => `With a color analyst in person: ${range}.`,
    trialFor: (price: string, days: number) => `${price} for ${days} days`,
    startTrial: (days: number, price: string) => `Start my ${days} days for ${price}`,
    welcomeSubject: (name: string) => (name ? `Welcome to Avarobe, ${name}` : 'Welcome to Avarobe'),
    welcomeEyebrow: 'Welcome to Avarobe',
    oneStepLeft: 'One step left',
    seasonDone: (season: string) => `Done. You’re a ${season}.`,
    getSeason: 'Get your color season',
    createAvatar: 'Create your avatar',
    createMyAvatar: 'Create my avatar',
    findMyColors: 'Find my colors',
    styleFirstOccasion: 'Style my first occasion',
    seeMyPalette: 'See my full palette',
    freeLookDone: 'Your free look is done',
    styleEveryOccasion: 'Style every occasion on your calendar.',
    lastReminder: 'Our last reminder',
  },

  hero: {
    wedding: 'Before and after: the outfit Avarobe planned for her daughter’s wedding',
    drape: 'A drape test: the same face next to black, camel, fuchsia and sage',
    occasions: 'The same woman styled by Avarobe for a wedding, an anniversary dinner and brunch with friends',
    avatarFlow: 'A selfie becomes a full-body avatar, then a styled look',
    paletteOffer:
      'Your photo: three panels in your best colors, blurred until you open your Color Advisor, and one in the color that drains you',
    priceDrop:
      'Your photo: on the left your #1 color, blurred until you open your report; on the right, a color to keep away from your face',
    book: 'The Outfit Formula Book: 120 outfit combinations that always work',
    magazine: 'Two personal magazine covers made with Avarobe',
    style: 'The same woman in a wrap dress and in straight trousers, side by side',
    hair: 'The same woman with copper hair and with auburn hair, side by side',
  },

  footer: {
    // `email` comes escaped in the HTML part.
    account: (email: string) => `You're receiving this because you created an Avarobe account with ${email}.`,
    preferences: 'Email preferences',
    unsubscribe: 'Unsubscribe from tips and reminders',
    tagline: 'Your AI stylist',
    // A purchase delivery, maybe to someone without an account.
    bought: (product: string, email: string) => `You're receiving this because you bought ${product} on avarobe.com with ${email}.`,
    // {email} becomes the address (a link in the HTML part).
    help: 'Questions or trouble downloading? Write to {email}.',
  },

  welcome: {
    preheader: 'Your personal stylist is ready: outfits for your next occasion, in your colors, on you.',
    heading: 'See what to wear. On you.',
    intro:
      'Thanks for joining. Tell Avarobe where you’re going, and it plans a complete outfit for the dress code, in the colors that suit you, and shows it on a full-body avatar that looks like you.',
    openLooks: 'Open my looks',
    avatarTodo: 'One selfie, plus your height and build. It takes about a minute.',
    avatarDone: 'Done. Your avatar is ready.',
    seasonTodo: 'Avarobe reads your undertone, depth and contrast from your selfie and names your season, free.',
    occasionTitle: 'Style your first occasion',
    occasionDone: 'Done. Your first looks are in your collections.',
    occasionTodo: (free: number) => `A wedding, an interview, a first date. Your first ${free} looks are free.`,
    next: 'Two things worth trying next: rate a look with “Love it” or “Not for me” so your stylist learns your taste, and remix a look you like in new colors or for another season.',
  },

  colorsWelcome: {
    preheader: 'Your colors from one selfie: your season, and the color that drains you, on your own face.',
    heading: 'See your colors. On you.',
    intro:
      'Thanks for joining. One selfie is all Avarobe needs to read your undertone, contrast and season, and to show the color that drains you on your own face. Your Color Advisor adds your best colors, on you. Then Avarobe styles outfits in your colors, on an avatar that looks like you.',
    seasonTodo: 'One selfie, about 15 seconds. Free.',
    drainTitle: 'See the color to keep away from your face',
    drainDone: 'Done. It’s waiting in your studio.',
    drainTodo: 'Your face in the color that drains you, from the same selfie.',
    avatarBody: 'A few quick answers, and every outfit shows up on you.',
    seeMyColors: 'See my colors',
  },

  avatarNudge: {
    colors: {
      subject: 'Your colors are one selfie away',
      preheader: 'About 15 seconds: your season, and your best and worst color on your own face.',
      heading: 'One selfie, and you’ll see your colors.',
      intro:
        'Avarobe reads your undertone, contrast and season from your face, then shows your best and worst color on you. For the best result:',
      checklist: [
        'Face a window in daylight, with no filter.',
        'Keep makeup light, so your natural coloring shows.',
        'Head and shoulders in the frame, no sunglasses or hat.',
      ],
      privacy: 'Your photo stays private. You can delete it, or your whole account, at any time from your account settings.',
    },
    avatar: {
      subject: 'Your stylist is waiting for one selfie',
      preheader: 'It takes about a minute, and it’s what makes every look yours.',
      heading: 'One selfie, and your stylist can start.',
      intro:
        'Your avatar is what lets Avarobe show outfits on you instead of on a model, and your selfie is how it reads your colors. For the best result:',
      checklist: [
        'Face a window in daylight, with no filter.',
        'Keep makeup light, so your natural coloring shows.',
        'Add your height and build. A full-body photo, if you have one, gets the proportions even closer.',
      ],
      privacy: 'Your photos stay private. You can delete them, or your whole account, at any time from your account settings.',
    },
  },

  looksNudge: {
    subject: (season: string | null) => (season ? `Your ${season} colors, ready to wear` : 'What’s your next occasion?'),
    preheader: (free: number) => `Your first ${free} looks are free. Tell Avarobe where you’re going.`,
    eyebrow: (free: number) => `Your first ${free} looks are free`,
    heading: 'Where are you going next?',
    paletteCaption: 'Your looks are built around colors like these.',
    intro:
      'Type the occasion and anything that matters, like the venue, the weather or a color you love. Avarobe plans complete outfits for the dress code and shows each one on your avatar.',
    startFrom: 'Start from one of these:',
    // Each one also fills in the occasion in the studio.
    occasions: ['Wedding guest', 'Job interview', 'Date night', 'Weekend brunch'],
  },

  offer: {
    trialCancel: "Cancel anytime before your trial ends, in your account settings, and you won't be charged again.",
    trialNote: (trial: string, days: number, monthly: string) =>
      `${trial} today for ${days} days, then ${monthly} a month until you cancel. Cancel anytime before your trial ends, in your account settings, and you won't be charged again.`,
    trialFeatures: (trialLooks: number, monthlyLooks: number) => [
      'Your full color report: every color that lights you up, on your own face',
      'Your style report: the cuts, necklines and haircuts that flatter you',
      `${trialLooks} looks for your occasions during the trial, then ${monthlyLooks} every month, shown on you`,
      'Try on any outfit from a photo, and every haircut picked for you',
    ],
    reportFeatures: [
      'Your full palette: 30+ colors in basics, accents and statements',
      'A drape test: your face next to your best and worst colors',
      'Neutrals, whites and metals, tested on you',
      'Guides for prints, denim, makeup and eyewear',
    ],
    proFeatures: (monthlyLooks: number) => [
      `${monthlyLooks} looks every month, planned for the dress code and shown on you`,
      'Try on any outfit from a photo, and every haircut picked for you',
      'Every piece of a look, found in stores',
      'Your color and style reports while you’re on Pro',
    ],
    colorAdvisorFeatures: [
      'Your best colors and your #1, on your own face',
      'Your full palette: 30+ colors in basics, accents and statements',
      'The live color mirror: 300+ fabrics on your face, each one marked yours, close or one to avoid',
      'Your drape test, your neutrals, gold or silver, your lip or shirt colors and your next hair color, side by side on you',
      'Outfits in your colors, color combinations and six practical guides',
      'Your color video, and five “does this color suit me?” checks for when you shop',
    ],
    // The one-time alternatives, and Pro monthly.
    colorReportDetail: 'Your full palette and drape test, yours to keep',
    packDetail: (looks: number) => `${looks} more looks. They never expire`,
    proMonthlyDetail: (looks: number) =>
      `${looks} looks a month on you, try-ons and every haircut, with your reports while you're on it. Cancel anytime`,
    // The rest of what Avarobe sells.
    products: {
      style: 'The cuts and necklines that flatter your body, tried on your avatar, with a fit guide and a capsule.',
      hair: 'Every haircut that suits your face, shown on you, with what to tell your stylist.',
      event: 'Three complete looks on you for your next event, every piece in stores.',
      bundle: 'Color, Style and Hair & Grooming together, for less.',
      pro: (looks: number) => `Your stylist all year: ${looks} looks a month on you and all three advisors. Cancel anytime.`,
      book: '120 outfit combinations that always work, as a PDF.',
    },

    // Out of free looks, trial off: Pro first.
    proSubject: 'Style every occasion on your calendar',
    proPreheader: (looks: number, monthly: string) =>
      `Avarobe Pro: ${looks} looks a month on you, try-ons and every haircut. ${monthly} a month, cancel anytime.`,
    proIntro: 'Your stylist has more looks waiting for you. With Avarobe Pro:',
    proLooks: (looks: number) => `${looks} looks every month.`,
    cancelAnytime: 'Cancel anytime in your account settings.',
    getPro: 'Get Avarobe Pro',

    // Trial on.
    trialSubject: (days: number, trial: string) => `Try Avarobe Pro: ${days} days for ${trial}`,
    trialPreheader: (trial: string, days: number) =>
      `Your full color and style reports, looks for every occasion on you, try-ons and every haircut. ${trial} for ${days} days.`,
    trialIntro: (days: number) => `Your stylist has more looks waiting for you. Try everything in Avarobe Pro for ${days} days:`,
  },

  paletteOffer: {
    subject: (name: string) => (name ? `${name}, your full color report is ready` : 'Your full color report is ready'),
    preheader: (price: string) =>
      `Everything a color analyst would tell you, on your own face: your best colors, 30+ colors, the live mirror and guides. ${price}, once.`,
    eyebrow: 'Your full color report is ready',
    heading: (season: string) => `You’re a ${season}.`,
    introPhoto:
      'Your full color report is made from your selfie: everything a color analyst would tell you, shown on your own face. That’s you above, in your best colors (blurred until you open it) and in the color that drains you.',
    intro: 'Your full color report is made from your selfie: everything a color analyst would tell you, shown on your own face.',
    button: (price: string) => `Get my full report · ${price}`,
    more: 'More from Avarobe',

    // Trial on.
    trialSubject: (season: string) => `Your full ${season} palette is waiting`,
    trialPreheader: (days: number, trial: string) =>
      `Your best colors are waiting. See them on your own face: ${days} days of Pro for ${trial}.`,
    trialEyebrow: 'Your colors',
    trialHeading: 'There’s more to your palette.',
    trialIntro: (days: number) => `See all of them on your own face, and try everything in Avarobe Pro for ${days} days:`,
  },

  priceDrop: {
    subject: (price: string) => `Your Color Advisor is now ${price}`,
    preheader: (price: string) =>
      `We lowered the price. See your #1 color and your full palette on your own face: ${price}, once. No subscription.`,
    eyebrow: 'A lower price',
    heading: (price: string) => `Your #1 color, now ${price}.`,
    introPhoto:
      'We lowered the price of the Color Advisor. The blurred half of your photo is you in your #1 color, the shade that lights up your face. It’s ready in your report.',
    intro: 'We lowered the price of the Color Advisor. Your #1 color, the shade that lights up your face, is ready in your report.',
    button: (price: string) => `See my #1 color · ${price}`,
  },

  reminder: {
    subject: (season: string | null) => (season ? `The rest of your ${season} palette` : 'The colors that light you up'),
    preheader: 'Your full palette, a drape test on your own face and guides for everything you wear.',
    eyebrow: 'Your Color Advisor',
    heading: 'See every color that lights you up.',
    caption: (count: number) => `You’ve seen ${count} of your colors. Your report shows all of them.`,
    intro: 'Your Color Advisor is a visual report made from your own photo, yours to keep:',
    checklist: [
      'Your full palette: 30+ colors in basics, accents and statements',
      'A drape test: your face next to your best and worst colors, like the one above',
      'The colors to keep away from your face, and your best metals',
      'Guides for prints, denim, makeup and eyewear',
    ],
    trialName: (days: number) => `Pro, ${days} days`,
    trialDetail: (monthly: string) =>
      `Your full color report, your style report and looks on you. Then ${monthly}/mo, cancel anytime`,
    tryIt: 'Try it',
    oneTimeDetail: 'One time, yours to keep',
    startHere: 'Start here',
  },

  lastCall: {
    subject: 'One last note about your colors',
    preheader: (once: string) => `Your full palette on your own face, ${once}. This is our last reminder.`,
    heading: 'Your full palette, on your own face.',
    intro:
      'This is our last note about plans. Your Color Advisor shows every color that lights you up and the ones to keep away from your face, made from your own photo and yours to keep.',
    orPro: 'Or style every occasion with Pro:',

    // Trial on.
    trialSubject: 'One last note about your stylist',
    trialPreheader: (days: number, trial: string) => `Everything in Pro for ${days} days for ${trial}. This is our last reminder.`,
    trialHeading: (days: number, trial: string) => `Everything in Pro, ${days} days for ${trial}.`,
    trialIntro: (reports: string) =>
      'This is our last note about plans. If Avarobe helped you dress for your first occasion, try your stylist for everything after it: your full color and style reports (' +
      reports +
      ' on their own), looks for every occasion on you, try-ons and every haircut.',
  },

  rescue: {
    // "Your Color Advisor is", "Your looks are".
    what: (product: string) => `Your ${PRODUCT_NAMES[product] ?? 'purchase'} ${PLURAL_PRODUCTS.has(product) ? 'are' : 'is'}`,
    subject: (what: string) => `${what} one step away`,
    preheader: 'Finish in your own browser, where Apple Pay and saved cards work.',
    eyebrow: 'Almost there',
    heading: (what: string) => `${what} one step away.`,
    intro:
      'You started checking out but didn’t finish. If you were paying inside Instagram or Facebook, their browser often can’t use Apple Pay or a saved card. This link opens Avarobe in your own browser, already signed in, right where you left off.',
    button: 'Finish in my browser',
    expiry: 'The link works once and expires in 3 days.',
  },

  // Bought the Color Advisor, never opened the report (it's written the
  // first time they open it).
  reportUnopened: {
    subject: 'Your color report is ready to open',
    preheader: 'Your best colors, your #1 and your full palette, on your own face.',
    eyebrow: 'Your Color Advisor',
    heading: (season: string | null) => (season ? `Your ${season} colors are waiting.` : 'Your colors are waiting.'),
    intro:
      'You unlocked your Color Advisor but haven’t opened your report yet. It takes about a minute to build: your best colors and your #1 on your own face, your full palette, the drape test and your guides.',
    button: 'Open my report',
    expiry: 'The link signs you in. It works once and expires in 3 days.',
  },

  trialStarted: {
    subject: (days: number) => `Your ${days} days of Avarobe Pro start now`,
    preheader: (end: string, monthly: string) => `Everything in Pro until ${end}. Then ${monthly} a month, or cancel anytime before.`,
    eyebrow: 'Avarobe Pro trial',
    heading: (end: string) => `Your stylist is all yours until ${end}.`,
    intro: 'Here’s what’s open for you now:',
    button: 'Open my studio',
    then: (monthly: string) => `Then ${monthly} a month`,
    renews: (end: string) => `Your plan renews on ${end} and every month after, until you cancel.`,
    paid: (trial: string, end: string) =>
      `Today you paid ${trial}. Cancel anytime before ${end} in your account settings and you won't be charged again. We'll remind you two days before.`,
  },

  trialEnding: {
    subject: (end: string) => `Your Pro trial ends ${end}`,
    preheader: (monthly: string, looks: number) =>
      `Then ${monthly} a month for ${looks} new looks, your reports and more. Cancel before if you'd rather not.`,
    eyebrow: 'A reminder about your trial',
    heading: (end: string) => `Your trial ends ${end}.`,
    body: (end: string, monthly: string, looks: number, left: number) =>
      `On ${end} your Avarobe Pro plan renews at ${monthly} a month. Keep it and nothing changes: ${looks} new looks every month on you, your color and style reports, try-ons and every haircut.` +
      (left > 0 ? ` You still have ${left} look${left === 1 ? '' : 's'} to use.` : ''),
    button: 'Keep styling',
    cancel: (end: string, annual: string, perMonth: string) =>
      `Rather not continue? Cancel in your account settings before ${end} and you won't be charged. Prefer a year? Pro annual is ${annual} (${perMonth}/mo) and keeps both reports for good.`,
  },

  guide: {
    subject: 'Your Outfit Formula Book is here',
    preheader: '120 outfit formulas, ready to download. Your link works anytime.',
    // What they bought, in the footer.
    receipt: 'The Outfit Formula Book',
    heading: 'Your guide is ready.',
    intro:
      'Thank you for your order. Your copy of The Outfit Formula Book is ready: 120 combinations that always work, the Color, Shape and Finish method, a color pairs cheat sheet and printable planners.',
    button: 'Download my guide (PDF)',
    keep: 'Save it to your phone or print it. This link is yours and works anytime, so keep this email.',
    colors: 'Curious which of these colors are yours? Avarobe finds your color season from one selfie, free.',
  },

  magazine: {
    subject: (name: string) => (name ? `${name}, your magazine is ready` : 'Your magazine is ready'),
    preheader: 'Your cover, a letter from your stylist and ten looks on you, on location.',
    receipt: 'Your Personal Magazine',
    heading: 'Your issue is out.',
    intro:
      'Your magazine is ready: your own cover, a letter from your stylist, and ten looks on you, on location, with why each one works and the pieces to find.',
    button: 'Read my magazine',
    keep: 'Open it on your phone or computer. You can save it as a PDF from there and keep it.',
  },

  crossSell: {
    styleFeatures: [
      'Your style archetype, in words you can shop with',
      'Silhouettes and necklines tried on your own avatar, with the ones that flatter you marked',
      'A fit guide: the lengths, rises and waists that work on you',
      'A 12-piece capsule in your colors and shapes',
    ],
    hairFeatures: [
      'Your face shape and hair type, and what they mean for your cut',
      'Six haircuts picked for you, each one on your own photo',
      'The brief for your stylist, in salon words',
      'The hair colors that flatter your skin (or, for menswear, the beard styles that suit your jaw)',
    ],
    magazineFeatures: [
      'Your own cover, with your name as the masthead',
      'A letter from your stylist about your colors and shapes',
      'Ten looks on you, on location, one for each moment you pick',
      'Why each look works, and the pieces to find',
    ],
    eventFeatures: [
      'Three complete looks for its dress code, on you',
      'Every piece found in stores, at your budget',
      'Shoes, bags, hair and makeup to finish each look',
      'A checklist for the day',
    ],
    // What's coming up, by the month in New York.
    upcoming: {
      october: 'Halloween parties and fall weddings are coming up.',
      november: 'Thanksgiving and the first holiday parties are coming up.',
      december: 'Holiday parties and New Year’s Eve are coming up.',
      other: 'A wedding, an interview, a night out?',
    },
    // The other report at the pair price, or at its own.
    pairPrice: (regular: string, owned: string, ends: string) => `Instead of ${regular}, because you have the ${owned}. Ends ${ends}.`,
    forYou: 'For you, on your own photos.',
    pairTail: (price: string, regular: string, ends: string) => `${price} instead of ${regular} for you, until ${ends}.`,
    onceTail: (price: string) => `${price}, once.`,
    getMy: (name: string, price: string) => `Get my ${name} · ${price}`,

    style: {
      subject: 'You know your colors. Now see your shapes.',
      preheader: (tail: string) => `The Style Advisor tries silhouettes and necklines on your own avatar. ${tail}`,
      eyebrow: 'Your next advisor',
      intro:
        'Your Color Advisor shows the colors that light up your face. The Style Advisor does the same for your body: it reads your proportions, then tries silhouettes and necklines on your own avatar, so you can see what flatters you and why.',
      colorsCaption: 'Your colors. The Style Advisor puts them into the cuts that suit you.',
      more: 'Get more from your colors',
      palette: 'My palette',
      mirror: 'The color mirror',
      check: 'Does this color suit me?',
    },
    color: {
      subjectAfterStyle: 'You know your shapes. Now find your colors.',
      subject: 'The colors that light up your face',
      preheader: (tail: string) => `Everything a color analyst would tell you, from one selfie, shown on your own face. ${tail}`,
      heading: 'Find the colors that light up your face.',
      introAfterStyle:
        'Your Style Advisor shows the shapes that flatter you. The Color Advisor finds the colors that light up your face, from one selfie, and shows every one of them on you.',
      intro: 'The Color Advisor finds your colors from one selfie: everything a color analyst would tell you, shown on your own face.',
    },
    lastCall: {
      subject: (name: string, price: string, weekday: string) => `Your ${name} at ${price} ends ${weekday}`,
      preheader: (owned: string, price: string, regular: string, ends: string) =>
        `Because you have the ${owned}: ${price} instead of ${regular}, until ${ends}.`,
      eyebrow: 'Last call',
      heading: (weekday: string) => `Your pair price ends ${weekday}.`,
      body: (owned: string, name: string, price: string, regular: string, ends: string) =>
        `Because you have the ${owned}, your ${name} is ${price} instead of ${regular}. That price ends ${ends}; after that it’s ${regular}.`,
    },
    hair: {
      subject: 'See your next haircut before you get it',
      preheader: (price: string) => `Six cuts picked for your face, on your own photo, and the hair colors that suit you. ${price}, once.`,
      heading: 'See your next haircut before you get it.',
      introSeason: (season: string) =>
        `Your hair frames your face as much as anything you wear. As a ${season}, some hair colors light you up and some wash you out. The Hair & Grooming Advisor reads your face shape and hair type from a selfie and shows the cuts and colors that suit you, on you.`,
      intro:
        'Your hair frames your face as much as anything you wear. The Hair & Grooming Advisor reads your face shape and hair type from a selfie and shows the cuts and hair colors that suit you, on you.',
      detail: 'Every cut picked for you, on your own photo.',
    },
    magazine: {
      subject: (name: string) => (name ? `${name}, you on the cover` : 'You, on the cover'),
      preheader: (price: string) =>
        `Your Personal Magazine: ten looks on you, on location, in your colors, with your own cover. ${price}, once.`,
      heading: 'A magazine about you, with you on the cover.',
      intro:
        'Pick the moments of your season (brunch, a big day at work, a wedding, a trip) and we plan a look for each one and shoot it on you, on location. Then we write it up: your cover, a letter from your stylist and why every look works.',
      colorsCaption: 'Every look in your issue is planned in your colors.',
      detail: 'One issue, about five minutes after you pick your moments.',
      button: (price: string) => `Make my magazine · ${price}`,
    },
    event: {
      subject: 'What are you wearing to your next event?',
      preheader: (price: string) => `Three complete looks for its dress code, on you, with every piece in stores. ${price} an event.`,
      heading: 'Never wonder what to wear to it again.',
      intro: (upcoming: string) =>
        `${upcoming} Tell us the event, the dress code and your budget: you get three complete outfits shown on you, every piece findable in stores, and how to finish the look.`,
      detail: 'Three complete looks for one event, on you.',
      button: (price: string) => `Style my event · ${price}`,
    },
    guide: {
      subject: '120 outfit formulas that always work',
      preheader: (price: string) =>
        `The Outfit Formula Book: 120 combinations, the Color, Shape and Finish method and printable planners. A ${price} PDF, yours to keep.`,
      heading: 'Never stare at a full closet again.',
      introSeason: (season: string) =>
        `Your ${season} palette tells you which colors are yours. The Outfit Formula Book shows how to put them together: 120 outfit combinations that always work, the Color, Shape and Finish method, a color pairs cheat sheet and printable planners.`,
      intro:
        'The Outfit Formula Book: 120 outfit combinations that always work, the Color, Shape and Finish method, a color pairs cheat sheet and printable planners.',
      detail: 'A PDF, yours to keep.',
      delivery: 'One-time payment. Instant download, and we email it to you too.',
      button: (price: string) => `Get the book · ${price}`,
    },
  },

  // Account emails (utils/email.ts).
  auth: {
    hi: (name: string) => `Hi ${name},`,
    hiAnonymous: 'Hi,',
    pasteLink: 'Or paste this link into your browser:',
    linkOnce24h: 'The link works once and expires in 24 hours.',
    linkOnce3d: 'The link works once and expires in 3 days.',
    confirmEmail: 'Confirm my email',
    nothingElse: 'If this was you, there is nothing else to do.',
    verification: {
      subject: 'Confirm your email for Avarobe',
      passkey:
        'Confirm this is your email to finish creating your Avarobe account. Right after, you will set up a passkey so you can sign in with Face ID, Touch ID or your device PIN.',
      password: 'Confirm this is your email. It lets you add passkeys and recover your account if you forget your password.',
      footer: "Didn't sign up for Avarobe? You can ignore this email.",
    },
    saved: {
      subject: 'Your Avarobe colors are saved',
      paragraphs: [
        'Your colors and everything you make in Avarobe are saved to this email. Confirm it with the button below.',
        'There is no password to remember: whenever you want to come back, ask for a sign-in link on the Avarobe sign-in page and we email you one. The link below works once and expires in 24 hours.',
      ],
      footer: "Didn't use Avarobe? You can ignore this email.",
    },
    signIn: {
      subject: 'Your Avarobe sign-in link',
      intro: 'Here is your link to sign in to Avarobe.',
      button: 'Sign in to Avarobe',
      footer: "Didn't ask for this? You can ignore this email; nobody can sign in without the link.",
    },
    continueInBrowser: {
      subject: 'Your link to open Avarobe in your browser',
      intro:
        'Here is your link to open Avarobe in your phone’s own browser, already signed in. There you can pay with Apple Pay or a saved card.',
      button: 'Open Avarobe',
      footer: "Didn't ask for this? You can ignore this email.",
    },
    passwordReset: {
      subject: 'Reset your Avarobe password',
      paragraphs: [
        'We got a request to reset the password for this email. Choose a new one with the button below.',
        'The link works once and expires in 1 hour. Resetting signs you out everywhere and removes your passkeys, so you can add them again safely.',
      ],
      button: 'Choose a new password',
      footer: "Didn't ask for this? Ignore this email and your password stays the same.",
    },
    passwordChanged: {
      subject: 'Your Avarobe password was changed',
      intro: 'The password for your Avarobe account was just changed.',
      button: "Wasn't me: reset my password",
    },
    passkeyAdded: {
      subject: 'A passkey was added to your Avarobe account',
      added: (device: string) => `A passkey for "${device}" can now sign in to your Avarobe account.`,
      notYou: "If this wasn't you, remove it in your account settings and reset your password.",
      button: 'Review my passkeys',
    },
  },
}

export type EmailCopy = typeof enEmails
