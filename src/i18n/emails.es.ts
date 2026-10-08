import type { EmailCopy } from './emails.en.js'

// The emails in Latin American Spanish (neutral, as written in Mexico; tú,
// never vos or vosotros), following emails.en.ts line by line. Dates come as
// "miércoles 7 de octubre" (always "el": "hasta el …", "antes del …") and
// prices as "$79.00" (pesos) or "USD 2.99" (i18n/emails.ts).

// "Tu Asesor de Color está a un paso" (checkout rescue).
const RESCUE: Record<string, string> = {
  color_report: 'Tu Asesor de Color está',
  color_addon: 'Tu Asesor de Color está',
  color_mirror: 'Tu Asesor de Color está',
  style_report: 'Tu Asesor de Estilo está',
  style_addon: 'Tu Asesor de Estilo está',
  reports_bundle: 'Tus Asesores de Color y de Estilo están',
  look_pack: 'Tus looks están',
  pro_monthly: 'Tu Avarobe Pro está',
  pro_annual: 'Tu Avarobe Pro está',
  pro_trial: 'Tu Avarobe Pro está',
  hair_advisor: 'Tu Asesor de Cabello y Barba está',
  advisors_bundle: 'Tus tres asesores están',
  event_pass: 'Tu Estilista de Eventos está',
  magazine: 'Tu revista personal está',
}

export const esEmails: EmailCopy = {
  lang: 'es',

  names: {
    colorAdvisor: 'Asesor de Color',
    styleAdvisor: 'Asesor de Estilo',
    hairAdvisor: 'Asesor de Cabello y Barba',
    eventStylist: 'Estilista de Eventos',
    allAdvisors: 'Los tres asesores',
    pro: 'Avarobe Pro',
    lookPack: 'Paquete de looks',
    book: 'El Libro de Fórmulas de Outfits',
    magazine: 'Tu revista personal',
  },

  common: {
    hi: (name: string) => `¡Hola, ${name}!`,
    hiThere: '¡Hola!',
    signoff: 'Te esperamos,',
    team: 'El equipo de Avarobe',
    tip: 'Consejo',
    doneMark: '[listo]',
    yourSeason: 'Tu estación',
    videoCaption: 'Todo lo que incluye, en un ejemplo',
    whatsInside: 'Qué incluye',
    seeWhatsInside: (seconds: number) => `Mira qué incluye · ${seconds} s`,
    seenColors: (count: number) =>
      `Ya viste ${count} de tus colores. Tu paleta completa tiene más de 30, con tus neutros y los que conviene alejar de tu cara.`,
    colorsWaiting:
      'Tus mejores colores, tu color #1 y más de 30 más, con tus neutros y los que conviene alejar de tu cara, están en tu Asesor de Color.',
    selfieTip: 'Para obtener los colores más precisos, tómate la selfie frente a una ventana con luz de día, sin filtro y con poco maquillaje.',
    orPayOnce: 'O paga una sola vez, sin suscripción:',
    buyNote: 'Abre tu pago con tu sesión ya iniciada. Apple Pay, Google Pay o tarjeta.',
    onceNote: 'Pago único, sin suscripción. Es tuyo para siempre.',
    oneTime: 'Pago único, sin suscripción.',
    noSubscription: 'Sin suscripción.',
    yoursToKeep: 'Es tuyo para siempre.',
    renewalNote: 'Pro se renueva cada mes hasta que canceles. Cancela cuando quieras en la configuración de tu cuenta.',
    notReady: '¿Todavía no? Tu avatar, tu estación y tus looks se quedan en tu cuenta, y puedes retomarlos cuando quieras.',
    manage: (url: string) => `Administra o cancela tu plan: ${url}`,
    priceOnce: (price: string) => `${price}, una sola vez`,
    once: (price: string) => `${price} una sola vez`,
    perEvent: (price: string) => `${price} por evento`,
    perMonthShort: (price: string) => `${price}/mes`,
    perMonth: (price: string) => `${price} al mes`,
    thenPerMonth: (price: string) => `Después, ${price} al mes.`,
    inPerson: (range: string) => `Un análisis de color en persona: ${range}.`,
    trialFor: (price: string, days: number) => `${price} por ${days} días`,
    startTrial: (days: number, price: string) => `Empezar mis ${days} días por ${price}`,
    welcomeSubject: (name: string) => (name ? `Te damos la bienvenida a Avarobe, ${name}` : 'Te damos la bienvenida a Avarobe'),
    welcomeEyebrow: 'Te damos la bienvenida',
    oneStepLeft: 'Solo falta un paso',
    seasonDone: (season: string) => `Listo. Eres ${season}.`,
    getSeason: 'Descubre tu estación de color',
    createAvatar: 'Crea tu avatar',
    createMyAvatar: 'Crear mi avatar',
    findMyColors: 'Descubrir mis colores',
    styleFirstOccasion: 'Armar mi primer look',
    seeMyPalette: 'Ver mi paleta completa',
    freeLookDone: 'Ya usaste tu look gratis',
    styleEveryOccasion: 'Vístete bien para cada ocasión de tu agenda.',
    lastReminder: 'Nuestro último recordatorio',
  },

  hero: {
    wedding: 'Antes y después: el outfit que Avarobe planeó para la boda de su hija',
    drape: 'Una prueba de telas: la misma cara junto al negro, el camel, el fucsia y el verde salvia',
    occasions: 'La misma mujer vestida por Avarobe para una boda, una cena de aniversario y un brunch con amigos',
    avatarFlow: 'Una selfie se convierte en un avatar de cuerpo completo y luego en un look armado',
    paletteOffer:
      'Tu foto: tres paneles en tus mejores colores, difuminados hasta que abras tu Asesor de Color, y uno en el color que te apaga',
    priceDrop:
      'Tu foto: a la izquierda, tu color #1, difuminado hasta que abras tu reporte; a la derecha, un color que conviene alejar de tu cara',
    book: 'El Libro de Fórmulas de Outfits: 120 combinaciones de outfits que siempre funcionan',
    magazine: 'Dos portadas de revista personal hechas con Avarobe',
    style: 'La misma mujer con un vestido cruzado y con un pantalón recto, lado a lado',
    hair: 'La misma mujer con cabello cobrizo y con cabello castaño rojizo, lado a lado',
  },

  footer: {
    account: (email: string) => `Recibes este correo porque creaste una cuenta de Avarobe con ${email}.`,
    preferences: 'Preferencias de correo',
    unsubscribe: 'Dejar de recibir consejos y recordatorios',
    tagline: 'Tu estilista con IA',
    bought: (product: string, email: string) => `Recibes este correo porque compraste ${product} en avarobe.com con ${email}.`,
    help: '¿Dudas o problemas con la descarga? Escríbenos a {email}.',
  },

  welcome: {
    preheader: 'Tu estilista personal está listo: outfits para tu próxima ocasión, en tus colores, en ti.',
    heading: 'Mira qué ponerte. En ti.',
    intro:
      'Gracias por unirte. Dile a Avarobe a dónde vas y planeará un outfit completo para el código de vestimenta, en los colores que te favorecen, y te lo mostrará en un avatar de cuerpo completo que se parece a ti.',
    openLooks: 'Abrir mis looks',
    avatarTodo: 'Una selfie, más tu estatura y tu complexión. Toma como un minuto.',
    avatarDone: 'Listo. Tu avatar ya está creado.',
    seasonTodo: 'Avarobe lee tu subtono, tu profundidad y tu contraste en tu selfie y te dice tu estación, gratis.',
    occasionTitle: 'Arma looks para tu primera ocasión',
    occasionDone: 'Listo. Tus primeros looks están en tus colecciones.',
    occasionTodo: (free: number) => `Una boda, una entrevista, una primera cita. Tus primeros ${free} looks son gratis.`,
    next: 'Dos cosas que vale la pena probar: califica un look con “Me encanta” o “No es para mí” para que tu estilista aprenda tu gusto, y haz un remix de un look que te guste en nuevos colores o para otra temporada.',
  },

  colorsWelcome: {
    preheader: 'Tus colores con una selfie: tu estación y el color que te apaga, en tu propia cara.',
    heading: 'Mira tus colores. En ti.',
    intro:
      'Gracias por unirte. Con una selfie, Avarobe lee tu subtono, tu contraste y tu estación, y te muestra en tu propia cara el color que te apaga. Tu Asesor de Color suma tus mejores colores, en ti. Luego Avarobe arma outfits en tus colores, en un avatar que se parece a ti.',
    seasonTodo: 'Una selfie, unos 15 segundos. Gratis.',
    drainTitle: 'Mira el color que conviene alejar de tu cara',
    drainDone: 'Listo. Te espera en tu estudio.',
    drainTodo: 'Tu cara en el color que te apaga, con la misma selfie.',
    avatarBody: 'Unas cuantas respuestas rápidas, y cada outfit aparece en ti.',
    seeMyColors: 'Ver mis colores',
  },

  avatarNudge: {
    colors: {
      subject: 'Tus colores están a una selfie de distancia',
      preheader: 'Unos 15 segundos: tu estación y tu mejor y tu peor color en tu propia cara.',
      heading: 'Una selfie y verás tus colores.',
      intro:
        'Avarobe lee tu subtono, tu contraste y tu estación en tu cara, y luego te muestra tu mejor y tu peor color en ti. Para el mejor resultado:',
      checklist: [
        'Ponte frente a una ventana con luz de día, sin filtro.',
        'Usa poco maquillaje, para que se vea tu colorido natural.',
        'Cabeza y hombros dentro del encuadre, sin lentes de sol ni sombrero.',
      ],
      privacy: 'Tu foto es privada. Puedes eliminarla, o eliminar toda tu cuenta, cuando quieras desde la configuración de tu cuenta.',
    },
    avatar: {
      subject: 'Tu estilista solo espera una selfie',
      preheader: 'Toma como un minuto, y es lo que hace que cada look sea tuyo.',
      heading: 'Una selfie y tu estilista puede empezar.',
      intro:
        'Tu avatar es lo que le permite a Avarobe mostrarte outfits en ti y no en una modelo, y con tu selfie lee tus colores. Para el mejor resultado:',
      checklist: [
        'Ponte frente a una ventana con luz de día, sin filtro.',
        'Usa poco maquillaje, para que se vea tu colorido natural.',
        'Agrega tu estatura y tu complexión. Una foto de cuerpo completo, si tienes una, hace que las proporciones sean aún más precisas.',
      ],
      privacy: 'Tus fotos son privadas. Puedes eliminarlas, o eliminar toda tu cuenta, cuando quieras desde la configuración de tu cuenta.',
    },
  },

  looksNudge: {
    subject: (season: string | null) => (season ? `Tus colores de ${season}, listos para usar` : '¿Cuál es tu próxima ocasión?'),
    preheader: (free: number) => `Tus primeros ${free} looks son gratis. Dile a Avarobe a dónde vas.`,
    eyebrow: (free: number) => `Tus primeros ${free} looks son gratis`,
    heading: '¿Cuál es tu próximo plan?',
    paletteCaption: 'Tus looks se arman con colores como estos.',
    intro:
      'Escribe la ocasión y todo lo que importe, como el lugar, el clima o un color que te encante. Avarobe arma outfits completos para el código de vestimenta y te muestra cada uno en tu avatar.',
    startFrom: 'Empieza con una de estas:',
    occasions: ['Ir a una boda', 'Entrevista de trabajo', 'Cita romántica', 'Brunch de fin de semana'],
  },

  offer: {
    trialCancel: 'Cancela cuando quieras antes de que termine tu prueba, en la configuración de tu cuenta, y no se te volverá a cobrar.',
    trialNote: (trial: string, days: number, monthly: string) =>
      `${trial} hoy por ${days} días, después ${monthly} al mes hasta que canceles. Cancela cuando quieras antes de que termine tu prueba, en la configuración de tu cuenta, y no se te volverá a cobrar.`,
    trialFeatures: (trialLooks: number, monthlyLooks: number) => [
      'Tu reporte de color completo: todos los colores que te iluminan, en tu propia cara',
      'Tu reporte de estilo: las siluetas, los escotes y los cortes de cabello que te favorecen',
      `${trialLooks} looks para tus ocasiones durante la prueba y después ${monthlyLooks} cada mes, en ti`,
      'Pruébate cualquier outfit a partir de una foto, y todos los cortes de cabello elegidos para ti',
    ],
    reportFeatures: [
      'Tu paleta completa: más de 30 colores entre básicos, de acento y protagonistas',
      'Una prueba de telas: tu cara junto a tus mejores y peores colores',
      'Neutros, blancos y metales, probados en ti',
      'Guías de estampados, mezclilla, maquillaje y lentes',
    ],
    proFeatures: (monthlyLooks: number) => [
      `${monthlyLooks} looks cada mes, planeados para el código de vestimenta y en ti`,
      'Pruébate cualquier outfit a partir de una foto, y todos los cortes de cabello elegidos para ti',
      'Cada prenda de un look, encontrada en tiendas',
      'Tus reportes de color y de estilo mientras tengas Pro',
    ],
    colorAdvisorFeatures: [
      'Tus mejores colores y tu color #1, en tu propia cara',
      'Tu paleta completa: más de 30 colores entre básicos, de acento y protagonistas',
      'El espejo de color en vivo: más de 300 telas en tu cara, cada una marcada como tuya, cercana o para evitar',
      'Tu prueba de telas, tus neutros, dorado o plateado, tus colores de labial o de camisa y tu próximo color de cabello, lado a lado en ti',
      'Outfits en tus colores, combinaciones de color y seis guías prácticas',
      'Tu video de color y cinco consultas de “¿me queda este color?” para cuando vayas de compras',
    ],
    colorReportDetail: 'Tu paleta completa y tu prueba de telas, tuyas para siempre',
    packDetail: (looks: number) => `${looks} looks más. Nunca caducan`,
    proMonthlyDetail: (looks: number) =>
      `${looks} looks al mes en ti, probador virtual y todos los cortes de cabello, con tus reportes mientras tengas Pro. Cancela cuando quieras`,
    products: {
      style: 'Los cortes y escotes que favorecen tu cuerpo, probados en tu avatar, con una guía de ajuste y un clóset cápsula.',
      hair: 'Todos los cortes de cabello que van con tu cara, en ti, con lo que debes decirle a tu estilista.',
      event: 'Tres looks completos en ti para tu próximo evento, con cada prenda en tiendas.',
      bundle: 'Color, Estilo y Cabello y Barba juntos, por menos.',
      pro: (looks: number) => `Tu estilista todo el año: ${looks} looks al mes en ti y los tres asesores. Cancela cuando quieras.`,
      book: '120 combinaciones de outfits que siempre funcionan, en PDF.',
    },

    proSubject: 'Vístete bien para cada ocasión de tu agenda',
    proPreheader: (looks: number, monthly: string) =>
      `Avarobe Pro: ${looks} looks al mes en ti, probador virtual y todos los cortes de cabello. ${monthly} al mes, cancela cuando quieras.`,
    proIntro: 'Tu estilista tiene más looks esperándote. Con Avarobe Pro:',
    proLooks: (looks: number) => `${looks} looks cada mes.`,
    cancelAnytime: 'Cancela cuando quieras en la configuración de tu cuenta.',
    getPro: 'Obtener Avarobe Pro',

    trialSubject: (days: number, trial: string) => `Prueba Avarobe Pro: ${days} días por ${trial}`,
    trialPreheader: (trial: string, days: number) =>
      `Tus reportes completos de color y de estilo, looks en ti para cada ocasión, probador virtual y todos los cortes de cabello. ${trial} por ${days} días.`,
    trialIntro: (days: number) => `Tu estilista tiene más looks esperándote. Prueba todo lo de Avarobe Pro durante ${days} días:`,
  },

  paletteOffer: {
    subject: (name: string) => (name ? `${name}, tu reporte de color completo está listo` : 'Tu reporte de color completo está listo'),
    preheader: (price: string) =>
      `Todo lo que te diría un análisis de color profesional, en tu propia cara: tus mejores colores, más de 30 colores, el espejo en vivo y guías. ${price}, una sola vez.`,
    eyebrow: 'Tu reporte de color completo está listo',
    heading: (season: string) => `Eres ${season}.`,
    introPhoto:
      'Tu reporte de color completo se hace con tu selfie: todo lo que te diría un análisis de color profesional, en tu propia cara. Arriba estás tú, en tus mejores colores (difuminados hasta que lo abras) y en el color que te apaga.',
    intro: 'Tu reporte de color completo se hace con tu selfie: todo lo que te diría un análisis de color profesional, en tu propia cara.',
    button: (price: string) => `Quiero mi reporte completo · ${price}`,
    more: 'Más de Avarobe',

    trialSubject: (season: string) => `Tu paleta completa de ${season} te espera`,
    trialPreheader: (days: number, trial: string) => `Tus mejores colores te esperan. Míralos en tu propia cara: ${days} días de Pro por ${trial}.`,
    trialEyebrow: 'Tus colores',
    trialHeading: 'Tu paleta tiene mucho más.',
    trialIntro: (days: number) => `Míralos todos en tu propia cara y prueba todo lo de Avarobe Pro durante ${days} días:`,
  },

  priceDrop: {
    subject: (price: string) => `Tu Asesor de Color ahora cuesta ${price}`,
    preheader: (price: string) =>
      `Bajamos el precio. Mira tu color #1 y tu paleta completa en tu propia cara: ${price}, una sola vez. Sin suscripción.`,
    eyebrow: 'Un precio más bajo',
    heading: (price: string) => `Tu color #1, ahora a ${price}.`,
    introPhoto:
      'Bajamos el precio del Asesor de Color. La mitad difuminada de tu foto eres tú en tu color #1, el tono que ilumina tu cara. Ya está listo en tu reporte.',
    intro: 'Bajamos el precio del Asesor de Color. Tu color #1, el tono que ilumina tu cara, ya está listo en tu reporte.',
    button: (price: string) => `Ver mi color #1 · ${price}`,
  },

  reminder: {
    subject: (season: string | null) => (season ? `El resto de tu paleta de ${season}` : 'Los colores que te iluminan'),
    preheader: 'Tu paleta completa, una prueba de telas en tu propia cara y guías para todo lo que te pones.',
    eyebrow: 'Tu Asesor de Color',
    heading: 'Mira todos los colores que te iluminan.',
    caption: (count: number) => `Ya viste ${count} de tus colores. Tu reporte te los muestra todos.`,
    intro: 'Tu Asesor de Color es un reporte visual hecho con tu propia foto, tuyo para siempre:',
    checklist: [
      'Tu paleta completa: más de 30 colores entre básicos, de acento y protagonistas',
      'Una prueba de telas: tu cara junto a tus mejores y peores colores, como la de arriba',
      'Los colores que conviene alejar de tu cara, y tus mejores metales',
      'Guías de estampados, mezclilla, maquillaje y lentes',
    ],
    trialName: (days: number) => `Pro, ${days} días`,
    trialDetail: (monthly: string) => `Tu reporte de color completo, tu reporte de estilo y looks en ti. Después, ${monthly}/mes, cancela cuando quieras`,
    tryIt: 'Pruébalo',
    oneTimeDetail: 'Un solo pago, tuyo para siempre',
    startHere: 'Empieza aquí',
  },

  lastCall: {
    subject: 'Una última nota sobre tus colores',
    preheader: (once: string) => `Tu paleta completa en tu propia cara, ${once}. Este es nuestro último recordatorio.`,
    heading: 'Tu paleta completa, en tu propia cara.',
    intro:
      'Esta es nuestra última nota sobre los planes. Tu Asesor de Color te muestra todos los colores que te iluminan y los que conviene alejar de tu cara, hecho con tu propia foto y tuyo para siempre.',
    orPro: 'O vístete bien para cada ocasión con Pro:',

    trialSubject: 'Una última nota sobre tu estilista',
    trialPreheader: (days: number, trial: string) => `Todo lo de Pro durante ${days} días por ${trial}. Este es nuestro último recordatorio.`,
    trialHeading: (days: number, trial: string) => `Todo lo de Pro, ${days} días por ${trial}.`,
    trialIntro: (reports: string) =>
      `Esta es nuestra última nota sobre los planes. Si Avarobe te ayudó a vestirte para tu primera ocasión, prueba a tu estilista para todo lo que sigue: tus reportes completos de color y de estilo (${reports} por separado), looks en ti para cada ocasión, probador virtual y todos los cortes de cabello.`,
  },

  rescue: {
    what: (product: string) => RESCUE[product] ?? 'Tu compra está',
    subject: (what: string) => `${what} a un paso`,
    preheader: 'Termina en tu propio navegador, donde funcionan Apple Pay y las tarjetas guardadas.',
    eyebrow: 'Ya casi',
    heading: (what: string) => `${what} a un paso.`,
    intro:
      'Empezaste a pagar, pero no terminaste. Si estabas pagando dentro de Instagram o Facebook, su navegador muchas veces no puede usar Apple Pay ni una tarjeta guardada. Este enlace abre Avarobe en tu propio navegador, con tu sesión ya iniciada, justo donde te quedaste.',
    button: 'Terminar en mi navegador',
    expiry: 'El enlace funciona una sola vez y caduca en 3 días.',
  },

  trialStarted: {
    subject: (days: number) => `Tus ${days} días de Avarobe Pro empiezan ahora`,
    preheader: (end: string, monthly: string) => `Todo lo de Pro hasta el ${end}. Después, ${monthly} al mes, o cancela cuando quieras antes.`,
    eyebrow: 'Prueba de Avarobe Pro',
    heading: (end: string) => `Tu estilista es todo tuyo hasta el ${end}.`,
    intro: 'Esto es lo que ya tienes disponible:',
    button: 'Abrir mi estudio',
    then: (monthly: string) => `Después, ${monthly} al mes`,
    renews: (end: string) => `Tu plan se renueva el ${end} y cada mes después, hasta que canceles.`,
    paid: (trial: string, end: string) =>
      `Hoy pagaste ${trial}. Cancela cuando quieras antes del ${end} en la configuración de tu cuenta y no se te volverá a cobrar. Te lo recordaremos dos días antes.`,
  },

  trialEnding: {
    subject: (end: string) => `Tu prueba de Pro termina el ${end}`,
    preheader: (monthly: string, looks: number) =>
      `Después, ${monthly} al mes por ${looks} looks nuevos, tus reportes y más. Cancela antes si prefieres no seguir.`,
    eyebrow: 'Un recordatorio sobre tu prueba',
    heading: (end: string) => `Tu prueba termina el ${end}.`,
    body: (end: string, monthly: string, looks: number, left: number) =>
      `El ${end} tu plan Avarobe Pro se renueva a ${monthly} al mes. Si lo conservas, nada cambia: ${looks} looks nuevos cada mes en ti, tus reportes de color y de estilo, probador virtual y todos los cortes de cabello.` +
      (left > 0 ? (left === 1 ? ' Todavía te queda 1 look por usar.' : ` Todavía te quedan ${left} looks por usar.`) : ''),
    button: 'Seguir armando looks',
    cancel: (end: string, annual: string, perMonth: string) =>
      `¿Prefieres no continuar? Cancela en la configuración de tu cuenta antes del ${end} y no se te cobrará. ¿Prefieres un año? Pro anual cuesta ${annual} (${perMonth}/mes) y conserva ambos reportes para siempre.`,
  },

  guide: {
    subject: 'Tu Libro de Fórmulas de Outfits ya está aquí',
    preheader: '120 fórmulas de outfits, listas para descargar. Tu enlace funciona siempre.',
    receipt: 'El Libro de Fórmulas de Outfits',
    heading: 'Tu guía está lista.',
    intro:
      'Gracias por tu compra. Tu ejemplar de El Libro de Fórmulas de Outfits está listo: 120 combinaciones que siempre funcionan, el método Color, Forma y Acabado, una guía rápida de pares de colores y planificadores para imprimir.',
    button: 'Descargar mi guía (PDF)',
    keep: 'Guárdala en tu celular o imprímela. Este enlace es tuyo y funciona siempre, así que conserva este correo.',
    colors: '¿Quieres saber cuáles de estos colores son los tuyos? Avarobe descubre tu estación de color con una selfie, gratis.',
  },

  magazine: {
    subject: (name: string) => (name ? `${name}, tu revista está lista` : 'Tu revista está lista'),
    preheader: 'Tu portada, una carta de tu estilista y diez looks en ti, en locación.',
    receipt: 'tu revista personal',
    heading: 'Ya salió tu edición.',
    intro:
      'Tu revista está lista: tu propia portada, una carta de tu estilista y diez looks en ti, en locación, con por qué funciona cada uno y las prendas para encontrarlos.',
    button: 'Leer mi revista',
    keep: 'Ábrela en tu celular o computadora. Desde ahí puedes guardarla como PDF y conservarla.',
  },

  crossSell: {
    styleFeatures: [
      'Tu arquetipo de estilo, en palabras que te sirven para comprar',
      'Siluetas y escotes probados en tu propio avatar, con los que te favorecen marcados',
      'Una guía de ajuste: los largos, tiros y cinturas que te funcionan',
      'Un clóset cápsula de 12 prendas en tus colores y formas',
    ],
    hairFeatures: [
      'La forma de tu cara y tu tipo de cabello, y lo que significan para tu corte',
      'Seis cortes de cabello elegidos para ti, cada uno en tu propia foto',
      'Las indicaciones para tu estilista, en palabras de salón',
      'Los colores de cabello que favorecen tu piel (o, en moda masculina, los estilos de barba que van con tu mandíbula)',
    ],
    magazineFeatures: [
      'Tu propia portada, con tu nombre como título de la revista',
      'Una carta de tu estilista sobre tus colores y formas',
      'Diez looks en ti, en locación, uno para cada momento que elijas',
      'Por qué funciona cada look, y las prendas para encontrarlo',
    ],
    eventFeatures: [
      'Tres looks completos para su código de vestimenta, en ti',
      'Cada prenda encontrada en tiendas, según tu presupuesto',
      'Zapatos, bolsas, peinado y maquillaje para completar cada look',
      'Un checklist para el día',
    ],
    // For all of Latin America: no Thanksgiving, and no fall in the south.
    upcoming: {
      october: 'Se acercan las fiestas de Halloween y las bodas.',
      november: 'Se acercan las primeras fiestas de fin de año.',
      december: 'Se acercan las fiestas de fin de año y la noche de Año Nuevo.',
      other: '¿Una boda, una entrevista, una salida de noche?',
    },
    pairPrice: (regular: string, owned: string, ends: string) => `En lugar de ${regular}, porque tienes el ${owned}. Termina el ${ends}.`,
    forYou: 'Para ti, en tus propias fotos.',
    pairTail: (price: string, regular: string, ends: string) => `${price} en lugar de ${regular} para ti, hasta el ${ends}.`,
    onceTail: (price: string) => `${price}, una sola vez.`,
    getMy: (name: string, price: string) => `Quiero mi ${name} · ${price}`,

    style: {
      subject: 'Ya conoces tus colores. Ahora mira tus formas.',
      preheader: (tail: string) => `El Asesor de Estilo prueba siluetas y escotes en tu propio avatar. ${tail}`,
      eyebrow: 'Tu siguiente asesor',
      intro:
        'Tu Asesor de Color te muestra los colores que iluminan tu cara. El Asesor de Estilo hace lo mismo con tu cuerpo: lee tus proporciones y luego prueba siluetas y escotes en tu propio avatar, para que veas qué te favorece y por qué.',
      colorsCaption: 'Tus colores. El Asesor de Estilo los lleva a los cortes que te favorecen.',
      more: 'Saca más provecho de tus colores',
      palette: 'Mi paleta',
      mirror: 'El espejo de color',
      check: '¿Me queda este color?',
    },
    color: {
      subjectAfterStyle: 'Ya conoces tus formas. Ahora descubre tus colores.',
      subject: 'Los colores que iluminan tu cara',
      preheader: (tail: string) => `Todo lo que te diría un análisis de color profesional, con una selfie y en tu propia cara. ${tail}`,
      heading: 'Descubre los colores que iluminan tu cara.',
      introAfterStyle:
        'Tu Asesor de Estilo te muestra las formas que te favorecen. El Asesor de Color descubre los colores que iluminan tu cara, con una selfie, y te muestra cada uno en ti.',
      intro: 'El Asesor de Color descubre tus colores con una selfie: todo lo que te diría un análisis de color profesional, en tu propia cara.',
    },
    lastCall: {
      subject: (name: string, price: string, weekday: string) => `Tu ${name} a ${price}, solo hasta el ${weekday}`,
      preheader: (owned: string, price: string, regular: string, ends: string) =>
        `Como ya tienes el ${owned}: ${price} en lugar de ${regular}, hasta el ${ends}.`,
      eyebrow: 'Última llamada',
      heading: (weekday: string) => `Tu precio especial termina el ${weekday}.`,
      body: (owned: string, name: string, price: string, regular: string, ends: string) =>
        `Como ya tienes el ${owned}, tu ${name} cuesta ${price} en lugar de ${regular}. Ese precio termina el ${ends}; después vuelve a ${regular}.`,
    },
    hair: {
      subject: 'Mira tu próximo corte antes de hacértelo',
      preheader: (price: string) =>
        `Seis cortes elegidos para tu cara, en tu propia foto, y los colores de cabello que te favorecen. ${price}, una sola vez.`,
      heading: 'Mira tu próximo corte antes de hacértelo.',
      introSeason: (season: string) =>
        `Tu cabello enmarca tu cara tanto como cualquier cosa que te pongas. Como ${season}, algunos colores de cabello te iluminan y otros te apagan. El Asesor de Cabello y Barba lee la forma de tu cara y tu tipo de cabello con una selfie y te muestra los cortes y colores que te favorecen, en ti.`,
      intro:
        'Tu cabello enmarca tu cara tanto como cualquier cosa que te pongas. El Asesor de Cabello y Barba lee la forma de tu cara y tu tipo de cabello con una selfie y te muestra los cortes y colores de cabello que te favorecen, en ti.',
      detail: 'Cada corte elegido para ti, en tu propia foto.',
    },
    magazine: {
      subject: (name: string) => (name ? `${name}, tú en la portada` : 'Tú, en la portada'),
      preheader: (price: string) =>
        `Tu revista personal: diez looks en ti, en locación, en tus colores, con tu propia portada. ${price}, una sola vez.`,
      heading: 'Una revista sobre ti, contigo en la portada.',
      intro:
        'Elige los momentos de tu temporada (un brunch, un gran día en el trabajo, una boda, un viaje) y planeamos un look para cada uno y te lo fotografiamos en locación. Luego lo escribimos: tu portada, una carta de tu estilista y por qué funciona cada look.',
      colorsCaption: 'Cada look de tu edición se planea en tus colores.',
      detail: 'Una edición, unos cinco minutos después de elegir tus momentos.',
      button: (price: string) => `Crear mi revista · ${price}`,
    },
    event: {
      subject: '¿Qué te vas a poner para tu próximo evento?',
      preheader: (price: string) => `Tres looks completos para su código de vestimenta, en ti, con cada prenda en tiendas. ${price} por evento.`,
      heading: 'No vuelvas a dudar qué ponerte.',
      intro: (upcoming: string) =>
        `${upcoming} Cuéntanos el evento, el código de vestimenta y tu presupuesto: recibes tres outfits completos en ti, con cada prenda disponible en tiendas, y cómo completar el look.`,
      detail: 'Tres looks completos para un evento, en ti.',
      button: (price: string) => `Armar los looks de mi evento · ${price}`,
    },
    guide: {
      subject: '120 fórmulas de outfits que siempre funcionan',
      preheader: (price: string) =>
        `El Libro de Fórmulas de Outfits: 120 combinaciones, el método Color, Forma y Acabado y planificadores para imprimir. Un PDF de ${price}, tuyo para siempre.`,
      heading: 'Adiós a quedarte viendo un clóset lleno sin saber qué ponerte.',
      introSeason: (season: string) =>
        `Tu paleta de ${season} te dice qué colores son tuyos. El Libro de Fórmulas de Outfits te muestra cómo combinarlos: 120 combinaciones de outfits que siempre funcionan, el método Color, Forma y Acabado, una guía rápida de pares de colores y planificadores para imprimir.`,
      intro:
        'El Libro de Fórmulas de Outfits: 120 combinaciones de outfits que siempre funcionan, el método Color, Forma y Acabado, una guía rápida de pares de colores y planificadores para imprimir.',
      detail: 'Un PDF, tuyo para siempre.',
      delivery: 'Pago único. Descarga inmediata, y también te lo enviamos por correo.',
      button: (price: string) => `Quiero el libro · ${price}`,
    },
  },

  auth: {
    hi: (name: string) => `¡Hola, ${name}!`,
    hiAnonymous: '¡Hola!',
    pasteLink: 'O pega este enlace en tu navegador:',
    linkOnce24h: 'El enlace funciona una sola vez y caduca en 24 horas.',
    linkOnce3d: 'El enlace funciona una sola vez y caduca en 3 días.',
    confirmEmail: 'Confirmar mi correo',
    nothingElse: 'Si fuiste tú, no tienes que hacer nada más.',
    verification: {
      subject: 'Confirma tu correo para Avarobe',
      passkey:
        'Confirma que este es tu correo para terminar de crear tu cuenta de Avarobe. Justo después, configurarás una passkey para iniciar sesión con Face ID, Touch ID o el PIN de tu dispositivo.',
      password: 'Confirma que este es tu correo. Así puedes agregar passkeys y recuperar tu cuenta si olvidas tu contraseña.',
      footer: '¿No te registraste en Avarobe? Puedes ignorar este correo.',
    },
    saved: {
      subject: 'Tus colores de Avarobe están guardados',
      paragraphs: [
        'Tus colores y todo lo que hagas en Avarobe están guardados en este correo. Confírmalo con el botón de abajo.',
        'No hay contraseña que recordar: cuando quieras volver, pide un enlace de acceso en la página de inicio de sesión de Avarobe y te lo enviamos por correo. El enlace de abajo funciona una sola vez y caduca en 24 horas.',
      ],
      footer: '¿No usaste Avarobe? Puedes ignorar este correo.',
    },
    signIn: {
      subject: 'Tu enlace para iniciar sesión en Avarobe',
      intro: 'Aquí está tu enlace para iniciar sesión en Avarobe.',
      button: 'Iniciar sesión en Avarobe',
      footer: '¿No lo pediste? Puedes ignorar este correo; nadie puede iniciar sesión sin el enlace.',
    },
    continueInBrowser: {
      subject: 'Tu enlace para abrir Avarobe en tu navegador',
      intro:
        'Aquí está tu enlace para abrir Avarobe en el navegador de tu celular, con tu sesión ya iniciada. Ahí puedes pagar con Apple Pay o con una tarjeta guardada.',
      button: 'Abrir Avarobe',
      footer: '¿No lo pediste? Puedes ignorar este correo.',
    },
    passwordReset: {
      subject: 'Restablece tu contraseña de Avarobe',
      paragraphs: [
        'Recibimos una solicitud para restablecer la contraseña de este correo. Elige una nueva con el botón de abajo.',
        'El enlace funciona una sola vez y caduca en 1 hora. Al restablecerla, se cierra tu sesión en todos lados y se eliminan tus passkeys, para que puedas agregarlas de nuevo de forma segura.',
      ],
      button: 'Elegir una nueva contraseña',
      footer: '¿No lo pediste? Ignora este correo y tu contraseña seguirá igual.',
    },
    passwordChanged: {
      subject: 'Se cambió tu contraseña de Avarobe',
      intro: 'La contraseña de tu cuenta de Avarobe se acaba de cambiar.',
      button: 'No fui yo: restablecer mi contraseña',
    },
    passkeyAdded: {
      subject: 'Se agregó una passkey a tu cuenta de Avarobe',
      added: (device: string) => `Una passkey de "${device}" ya puede iniciar sesión en tu cuenta de Avarobe.`,
      notYou: 'Si no fuiste tú, elimínala en la configuración de tu cuenta y restablece tu contraseña.',
      button: 'Revisar mis passkeys',
    },
  },
}
