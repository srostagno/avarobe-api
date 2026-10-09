import type { EmailCopy } from './emails.en.js'

// The emails in Brazilian Portuguese (você), following emails.en.ts line by
// line. Dates come as "quarta-feira, 7 de outubro" and prices as "R$ 14,90"
// (i18n/emails.ts), so sentences never put an article before a date.

// "Seu Consultor de Cores está a um passo" (checkout rescue).
const RESCUE: Record<string, string> = {
  color_report: 'Seu Consultor de Cores está',
  color_addon: 'Seu Consultor de Cores está',
  color_mirror: 'Seu Consultor de Cores está',
  style_report: 'Seu Consultor de Estilo está',
  style_addon: 'Seu Consultor de Estilo está',
  reports_bundle: 'Seus Consultores de Cores e de Estilo estão',
  look_pack: 'Seus looks estão',
  pro_monthly: 'Seu Avarobe Pro está',
  pro_annual: 'Seu Avarobe Pro está',
  pro_trial: 'Seu Avarobe Pro está',
  hair_advisor: 'Seu Consultor de Cabelo e Barba está',
  advisors_bundle: 'Seus três consultores estão',
  event_pass: 'Seu Stylist de Eventos está',
  magazine: 'Sua revista personalizada está',
}

export const ptBrEmails: EmailCopy = {
  lang: 'pt-BR',

  names: {
    colorAdvisor: 'Consultor de Cores',
    styleAdvisor: 'Consultor de Estilo',
    hairAdvisor: 'Consultor de Cabelo e Barba',
    eventStylist: 'Stylist de Eventos',
    allAdvisors: 'Os três consultores',
    pro: 'Avarobe Pro',
    lookPack: 'Pacote de looks',
    book: 'O Livro de Fórmulas de Looks',
    magazine: 'Sua revista personalizada',
  },

  common: {
    hi: (name: string) => `Olá, ${name},`,
    hiThere: 'Olá,',
    signoff: 'Nos vemos por lá,',
    team: 'Equipe Avarobe',
    tip: 'Dica',
    doneMark: '[feito]',
    yourSeason: 'Sua estação',
    videoCaption: 'Tudo o que vem incluído, mostrado em um exemplo',
    whatsInside: 'O que inclui',
    seeWhatsInside: (seconds: number) => `Veja o que inclui · ${seconds} s`,
    seenColors: (count: number) =>
      `Você já viu ${count} das suas cores. Sua paleta completa tem mais de 30, com seus neutros e as cores que devem ficar longe do rosto.`,
    colorsWaiting:
      'Suas melhores cores, sua cor nº 1 e mais de 30 outras, com seus neutros e as cores que devem ficar longe do rosto, estão no seu Consultor de Cores.',
    selfieTip: 'Para cores mais precisas, tire sua selfie de frente para uma janela, com luz do dia, sem filtro e com pouca maquiagem.',
    orPayOnce: 'Ou pague uma vez, sem assinatura:',
    buyNote: 'Abre o pagamento já com sua conta conectada. Apple Pay, Google Pay ou cartão.',
    onceNote: 'Pagamento único, sem assinatura. É seu para sempre.',
    oneTime: 'Pagamento único, sem assinatura.',
    noSubscription: 'Sem assinatura.',
    yoursToKeep: 'É seu para sempre.',
    renewalNote: 'O Pro é renovado todo mês até você cancelar. Cancele quando quiser nas configurações da sua conta.',
    notReady: 'Ainda não é a hora? Seu avatar, sua estação e seus looks continuam na sua conta, e você pode retomar quando quiser.',
    manage: (url: string) => `Gerencie ou cancele seu plano: ${url}`,
    priceOnce: (price: string) => `${price}, uma vez só`,
    once: (price: string) => `${price} uma vez só`,
    perEvent: (price: string) => `${price} por evento`,
    perMonthShort: (price: string) => `${price}/mês`,
    perMonth: (price: string) => `${price} por mês`,
    thenPerMonth: (price: string) => `Depois, ${price} por mês.`,
    inPerson: (range: string) => `Análise de coloração presencial: ${range}.`,
    trialFor: (price: string, days: number) => `${price} por ${days} dias`,
    startTrial: (days: number, price: string) => `Começar meus ${days} dias por ${price}`,
    welcomeSubject: (name: string) => (name ? `Boas-vindas ao Avarobe, ${name}` : 'Boas-vindas ao Avarobe'),
    welcomeEyebrow: 'Boas-vindas ao Avarobe',
    oneStepLeft: 'Falta só um passo',
    seasonDone: (season: string) => `Feito. Você é ${season}.`,
    getSeason: 'Descubra sua estação de cores',
    createAvatar: 'Crie seu avatar',
    createMyAvatar: 'Criar meu avatar',
    findMyColors: 'Descobrir minhas cores',
    styleFirstOccasion: 'Montar meu primeiro look',
    seeMyPalette: 'Ver minha paleta completa',
    freeLookDone: 'Você já usou seu look grátis',
    styleEveryOccasion: 'Vista-se bem para cada ocasião da sua agenda.',
    lastReminder: 'Nosso último lembrete',
  },

  hero: {
    wedding: 'Antes e depois: o look que o Avarobe montou para o casamento da filha dela',
    drape: 'Um teste de tecidos: o mesmo rosto ao lado de preto, camelo, fúcsia e sálvia',
    occasions: 'A mesma mulher vestida pelo Avarobe para um casamento, um jantar de aniversário de casamento e um brunch com amigos',
    avatarFlow: 'Uma selfie vira um avatar de corpo inteiro e, depois, um look completo',
    paletteOffer:
      'Sua foto: três painéis nas suas melhores cores, desfocados até você abrir seu Consultor de Cores, e um na cor que apaga você',
    priceDrop:
      'Sua foto: à esquerda, sua cor nº 1, desfocada até você abrir seu relatório; à direita, uma cor que deve ficar longe do rosto',
    book: 'O Livro de Fórmulas de Looks: 120 combinações de looks que sempre funcionam',
    magazine: 'Duas capas de revista personalizada feitas com o Avarobe',
    style: 'A mesma mulher com um vestido transpassado e com uma calça reta, lado a lado',
    hair: 'A mesma mulher com cabelo acobreado e com cabelo ruivo acastanhado, lado a lado',
  },

  footer: {
    account: (email: string) => `Você está recebendo este e-mail porque criou uma conta Avarobe com ${email}.`,
    preferences: 'Preferências de e-mail',
    unsubscribe: 'Parar de receber dicas e lembretes',
    tagline: 'Seu stylist com IA',
    bought: (product: string, email: string) => `Você está recebendo este e-mail porque comprou ${product} em avarobe.com com ${email}.`,
    help: 'Dúvidas ou problemas com o download? Escreva para {email}.',
  },

  welcome: {
    preheader: 'Seu stylist pessoal está pronto: looks para sua próxima ocasião, nas suas cores, em você.',
    heading: 'Veja o que vestir. Em você.',
    intro:
      'Que bom ter você aqui. Conte ao Avarobe aonde você vai, e ele monta um look completo para o dress code, nas cores que combinam com você, e mostra tudo em um avatar de corpo inteiro parecido com você.',
    openLooks: 'Abrir meus looks',
    avatarTodo: 'Uma selfie, mais sua altura e seu tipo de corpo. Leva cerca de um minuto.',
    avatarDone: 'Feito. Seu avatar está pronto.',
    seasonTodo: 'O Avarobe lê seu subtom, sua profundidade e seu contraste na selfie e diz qual é a sua estação, grátis.',
    occasionTitle: 'Monte looks para sua primeira ocasião',
    occasionDone: 'Feito. Seus primeiros looks estão nas suas coleções.',
    occasionTodo: (free: number) => `Um casamento, uma entrevista, um primeiro encontro. Seus primeiros ${free} looks são grátis.`,
    next: 'Duas coisas para experimentar agora: avalie um look com “Amei” ou “Não é pra mim” para seu stylist aprender seu gosto, e faça um remix de um look de que você gostou em novas cores ou para outra estação do ano.',
  },

  colorsWelcome: {
    preheader: 'Suas cores a partir de uma selfie: sua estação e a cor que apaga você, no seu próprio rosto.',
    heading: 'Veja suas cores. Em você.',
    intro:
      'Que bom ter você aqui. Uma selfie é tudo de que o Avarobe precisa para ler seu subtom, seu contraste e sua estação, e para mostrar no seu próprio rosto a cor que apaga você. Seu Consultor de Cores acrescenta suas melhores cores, em você. Depois, o Avarobe monta looks nas suas cores, em um avatar parecido com você.',
    seasonTodo: 'Uma selfie, cerca de 15 segundos. Grátis.',
    drainTitle: 'Veja a cor que deve ficar longe do rosto',
    drainDone: 'Feito. Ela está esperando por você no seu estúdio.',
    drainTodo: 'Seu rosto na cor que apaga você, a partir da mesma selfie.',
    avatarBody: 'Algumas respostas rápidas, e cada look aparece em você.',
    seeMyColors: 'Ver minhas cores',
  },

  avatarNudge: {
    colors: {
      subject: 'Suas cores estão a uma selfie de distância',
      preheader: 'Cerca de 15 segundos: sua estação e sua melhor e sua pior cor no seu próprio rosto.',
      heading: 'Uma selfie, e você vê suas cores.',
      intro:
        'O Avarobe lê seu subtom, seu contraste e sua estação no seu rosto e depois mostra sua melhor e sua pior cor em você. Para o melhor resultado:',
      checklist: [
        'Fique de frente para uma janela, com luz do dia e sem filtro.',
        'Use pouca maquiagem, para sua coloração natural aparecer.',
        'Cabeça e ombros no enquadramento, sem óculos de sol nem chapéu.',
      ],
      privacy: 'Sua foto continua privada. Você pode excluí-la, ou excluir sua conta inteira, quando quiser nas configurações da sua conta.',
    },
    avatar: {
      subject: 'Seu stylist só está esperando uma selfie',
      preheader: 'Leva cerca de um minuto, e é o que faz cada look ser seu.',
      heading: 'Uma selfie, e seu stylist pode começar.',
      intro:
        'É o seu avatar que permite ao Avarobe mostrar looks em você, e não em uma modelo, e é pela sua selfie que ele lê suas cores. Para o melhor resultado:',
      checklist: [
        'Fique de frente para uma janela, com luz do dia e sem filtro.',
        'Use pouca maquiagem, para sua coloração natural aparecer.',
        'Informe sua altura e seu tipo de corpo. Uma foto de corpo inteiro, se você tiver, deixa as proporções ainda mais precisas.',
      ],
      privacy: 'Suas fotos continuam privadas. Você pode excluí-las, ou excluir sua conta inteira, quando quiser nas configurações da sua conta.',
    },
  },

  looksNudge: {
    subject: (season: string | null) => (season ? `Suas cores de ${season}, prontas para vestir` : 'Qual é a sua próxima ocasião?'),
    preheader: (free: number) => `Seus primeiros ${free} looks são grátis. Conte ao Avarobe aonde você vai.`,
    eyebrow: (free: number) => `Seus primeiros ${free} looks são grátis`,
    heading: 'Para onde você vai agora?',
    paletteCaption: 'Seus looks são montados com cores como estas.',
    intro:
      'Escreva a ocasião e tudo o que importa, como o local, o clima ou uma cor que você ama. O Avarobe monta looks completos para o dress code e mostra cada um no seu avatar.',
    startFrom: 'Comece por uma destas:',
    occasions: ['Ir a um casamento', 'Entrevista de emprego', 'Encontro romântico', 'Brunch de fim de semana'],
  },

  offer: {
    trialCancel: 'Cancele quando quiser antes do fim do período de teste, nas configurações da sua conta, e nada mais será cobrado.',
    trialNote: (trial: string, days: number, monthly: string) =>
      `${trial} hoje por ${days} dias, depois ${monthly} por mês até você cancelar. Cancele quando quiser antes do fim do período de teste, nas configurações da sua conta, e nada mais será cobrado.`,
    trialFeatures: (trialLooks: number, monthlyLooks: number) => [
      'Seu relatório de cores completo: todas as cores que iluminam você, no seu próprio rosto',
      'Seu relatório de estilo: as modelagens, os decotes e os cortes de cabelo que valorizam você',
      `${trialLooks} looks para suas ocasiões durante o teste e depois ${monthlyLooks} por mês, mostrados em você`,
      'Prove qualquer look a partir de uma foto, e todos os cortes de cabelo escolhidos para você',
    ],
    reportFeatures: [
      'Sua paleta completa: mais de 30 cores, entre básicas, de destaque e marcantes',
      'Um teste de tecidos: seu rosto ao lado das suas melhores e piores cores',
      'Neutros, brancos e metais, testados em você',
      'Guias de estampas, jeans, maquiagem e óculos',
    ],
    proFeatures: (monthlyLooks: number) => [
      `${monthlyLooks} looks por mês, montados para o dress code e mostrados em você`,
      'Prove qualquer look a partir de uma foto, e todos os cortes de cabelo escolhidos para você',
      'Cada peça de um look, encontrada em lojas',
      'Seus relatórios de cores e de estilo enquanto você tiver o Pro',
    ],
    colorAdvisorFeatures: [
      'Suas melhores cores e sua cor nº 1, no seu próprio rosto',
      'Sua paleta completa: mais de 30 cores, entre básicas, de destaque e marcantes',
      'O espelho de cores ao vivo: mais de 300 tecidos no seu rosto, cada um marcado como seu, quase seu ou para evitar',
      'Seu teste de tecidos, seus neutros, dourado ou prateado, suas cores de batom ou de camisa e sua próxima cor de cabelo, lado a lado em você',
      'Looks nas suas cores, combinações de cores e seis guias práticos',
      'Seu vídeo de cores e cinco consultas “essa cor fica bem em mim?” para quando você for às compras',
    ],
    colorReportDetail: 'Sua paleta completa e o teste de tecidos, para sempre seus',
    packDetail: (looks: number) => `Mais ${looks} looks. Eles nunca expiram`,
    proMonthlyDetail: (looks: number) =>
      `${looks} looks por mês em você, provador virtual e todos os cortes de cabelo, com seus relatórios enquanto você assinar. Cancele quando quiser`,
    products: {
      style: 'As modelagens e os decotes que valorizam seu corpo, provados no seu avatar, com um guia de caimento e um armário-cápsula.',
      hair: 'Todos os cortes de cabelo que combinam com seu rosto, mostrados em você, com o que dizer ao seu cabeleireiro.',
      event: 'Três looks completos em você para seu próximo evento, com cada peça encontrada em lojas.',
      bundle: 'Cores, Estilo e Cabelo e Barba juntos, por menos.',
      pro: (looks: number) => `Seu stylist o ano todo: ${looks} looks por mês em você e os três consultores. Cancele quando quiser.`,
      book: '120 combinações de looks que sempre funcionam, em PDF.',
    },

    proSubject: 'Vista-se bem para cada ocasião da sua agenda',
    proPreheader: (looks: number, monthly: string) =>
      `Avarobe Pro: ${looks} looks por mês em você, provador virtual e todos os cortes de cabelo. ${monthly} por mês, cancele quando quiser.`,
    proIntro: 'Seu stylist tem mais looks esperando por você. Com o Avarobe Pro:',
    proLooks: (looks: number) => `${looks} looks por mês.`,
    cancelAnytime: 'Cancele quando quiser nas configurações da sua conta.',
    getPro: 'Assinar o Avarobe Pro',

    trialSubject: (days: number, trial: string) => `Experimente o Avarobe Pro: ${days} dias por ${trial}`,
    trialPreheader: (trial: string, days: number) =>
      `Seus relatórios completos de cores e de estilo, looks em você para cada ocasião, provador virtual e todos os cortes de cabelo. ${trial} por ${days} dias.`,
    trialIntro: (days: number) => `Seu stylist tem mais looks esperando por você. Experimente tudo do Avarobe Pro por ${days} dias:`,
  },

  paletteOffer: {
    subject: (name: string) => (name ? `${name}, seu relatório de cores completo está pronto` : 'Seu relatório de cores completo está pronto'),
    preheader: (price: string) =>
      `Tudo o que uma análise de coloração pessoal mostraria, no seu próprio rosto: suas melhores cores, mais de 30 cores, o espelho ao vivo e guias. ${price}, uma vez só.`,
    eyebrow: 'Seu relatório de cores completo está pronto',
    heading: (season: string) => `Você é ${season}.`,
    introPhoto:
      'Seu relatório de cores completo é feito a partir da sua selfie: tudo o que uma análise de coloração pessoal mostraria, no seu próprio rosto. Essa aí em cima é você, nas suas melhores cores (desfocadas até você abrir o relatório) e na cor que apaga você.',
    intro: 'Seu relatório de cores completo é feito a partir da sua selfie: tudo o que uma análise de coloração pessoal mostraria, no seu próprio rosto.',
    button: (price: string) => `Quero meu relatório completo · ${price}`,
    more: 'Mais do Avarobe',

    trialSubject: (season: string) => `Sua paleta completa de ${season} está esperando por você`,
    trialPreheader: (days: number, trial: string) =>
      `Suas melhores cores estão esperando. Veja-as no seu próprio rosto: ${days} dias de Pro por ${trial}.`,
    trialEyebrow: 'Suas cores',
    trialHeading: 'Sua paleta tem muito mais.',
    trialIntro: (days: number) => `Veja todas elas no seu próprio rosto e experimente tudo do Avarobe Pro por ${days} dias:`,
  },

  priceDrop: {
    subject: (price: string) => `Seu Consultor de Cores agora custa ${price}`,
    preheader: (price: string) =>
      `Baixamos o preço. Veja sua cor nº 1 e sua paleta completa no seu próprio rosto: ${price}, uma vez só. Sem assinatura.`,
    eyebrow: 'Um preço menor',
    heading: (price: string) => `Sua cor nº 1, agora por ${price}.`,
    introPhoto:
      'Baixamos o preço do Consultor de Cores. A metade desfocada da sua foto é você na sua cor nº 1, o tom que ilumina seu rosto. Ela já está pronta no seu relatório.',
    intro: 'Baixamos o preço do Consultor de Cores. Sua cor nº 1, o tom que ilumina seu rosto, já está pronta no seu relatório.',
    button: (price: string) => `Ver minha cor nº 1 · ${price}`,
  },

  reminder: {
    subject: (season: string | null) => (season ? `O resto da sua paleta de ${season}` : 'As cores que iluminam você'),
    preheader: 'Sua paleta completa, um teste de tecidos no seu próprio rosto e guias para tudo o que você veste.',
    eyebrow: 'Seu Consultor de Cores',
    heading: 'Veja todas as cores que iluminam você.',
    caption: (count: number) => `Você já viu ${count} das suas cores. Seu relatório mostra todas.`,
    intro: 'Seu Consultor de Cores é um relatório visual feito a partir da sua própria foto, e é seu para sempre:',
    // Colors first, with their own photo above (the locked drape test).
    introPhoto:
      'Essa é você acima: a cor que apaga seu rosto, ao lado das suas melhores cores, ainda desfocadas. Seu Consultor de Cores mostra todas no seu próprio rosto, e é seu para sempre:',
    checklist: [
      'Sua paleta completa: mais de 30 cores, entre básicas, de destaque e marcantes',
      'Um teste de tecidos: seu rosto ao lado das suas melhores e piores cores, como o de cima',
      'As cores que devem ficar longe do rosto e seus melhores metais',
      'Guias de estampas, jeans, maquiagem e óculos',
    ],
    trialName: (days: number) => `Pro, ${days} dias`,
    trialDetail: (monthly: string) =>
      `Seu relatório de cores completo, seu relatório de estilo e looks em você. Depois, ${monthly}/mês, cancele quando quiser`,
    tryIt: 'Experimente',
    oneTimeDetail: 'Pagamento único, para sempre seu',
    startHere: 'Comece aqui',
  },

  lastCall: {
    subject: 'Um último recado sobre suas cores',
    preheader: (once: string) => `Sua paleta completa no seu próprio rosto, ${once}. Este é nosso último lembrete.`,
    heading: 'Sua paleta completa, no seu próprio rosto.',
    intro:
      'Este é nosso último recado sobre os planos. Seu Consultor de Cores mostra todas as cores que iluminam você e as que devem ficar longe do rosto, é feito a partir da sua própria foto e é seu para sempre.',
    introPhoto:
      'Este é nosso último lembrete. Acima está a sua própria foto: suas melhores cores continuam desfocadas, ao lado da que apaga seu rosto. Seu Consultor de Cores mostra todas as cores que iluminam você e as que devem ficar longe do seu rosto, feito a partir da sua selfie e seu para sempre.',
    orPro: 'Ou vista-se bem para cada ocasião com o Pro:',

    trialSubject: 'Um último recado sobre seu stylist',
    trialPreheader: (days: number, trial: string) => `Tudo do Pro por ${days} dias por ${trial}. Este é nosso último lembrete.`,
    trialHeading: (days: number, trial: string) => `Tudo do Pro, ${days} dias por ${trial}.`,
    trialIntro: (reports: string) =>
      `Este é nosso último recado sobre os planos. Se o Avarobe ajudou você a se vestir para sua primeira ocasião, experimente seu stylist para tudo o que vem depois: seus relatórios completos de cores e de estilo (${reports} se comprados à parte), looks em você para cada ocasião, provador virtual e todos os cortes de cabelo.`,
  },

  rescue: {
    what: (product: string) => RESCUE[product] ?? 'Sua compra está',
    subject: (what: string) => `${what} a um passo`,
    preheader: 'Finalize no seu próprio navegador, onde o Apple Pay e os cartões salvos funcionam.',
    eyebrow: 'Quase lá',
    heading: (what: string) => `${what} a um passo.`,
    intro:
      'Você começou a finalizar a compra, mas não concluiu. Se estava pagando dentro do Instagram ou do Facebook, o navegador deles muitas vezes não consegue usar o Apple Pay nem um cartão salvo. Este link abre o Avarobe no seu próprio navegador, já com sua conta conectada, exatamente onde você parou.',
    button: 'Finalizar no meu navegador',
    expiry: 'O link funciona uma vez e expira em 3 dias.',
  },

  payLink: {
    subject: (name: string, wallet: string) => `${name}: pague com ${wallet} em um toque`,
    preheader: (wallet: string) => `Abre no navegador do seu celular, com sua conta conectada e o ${wallet} pronto.`,
    heading: 'Um toque e é seu.',
    intro: (app: string, wallet: string) =>
      `Você tocou em Comprar dentro do ${app}, onde o ${wallet} não funciona. Este botão abre o Avarobe no navegador do seu celular, já com sua conta conectada e o pagamento pronto: pague com ${wallet} ou um cartão salvo em um toque.`,
    anyApp: 'Instagram ou do Facebook',
    button: (wallet: string) => `Pagar com ${wallet}`,
    expiry: 'Já pagou no app? Então está tudo certo. O link conecta sua conta, funciona uma vez e expira em 3 dias.',
  },

  reportUnopened: {
    subject: 'Seu relatório de cores está pronto para abrir',
    preheader: 'Suas melhores cores, a sua nº 1 e sua cartela completa, no seu próprio rosto.',
    eyebrow: 'Seu Consultor de Cores',
    heading: (season: string | null) => (season ? `Suas cores de ${season} estão esperando por você.` : 'Suas cores estão esperando por você.'),
    intro:
      'Você liberou seu Consultor de Cores, mas ainda não abriu seu relatório. Ele fica pronto em cerca de um minuto: suas melhores cores e a sua nº 1 no seu rosto, sua cartela completa, o teste de tecidos e seus guias.',
    button: 'Abrir meu relatório',
    expiry: 'O link já entra na sua conta. Funciona uma vez e expira em 3 dias.',
  },

  trialStarted: {
    subject: (days: number) => `Seus ${days} dias de Avarobe Pro começam agora`,
    preheader: (end: string, monthly: string) => `Tudo do Pro até ${end}. Depois, ${monthly} por mês, ou cancele quando quiser antes disso.`,
    eyebrow: 'Teste do Avarobe Pro',
    heading: (end: string) => `Seu stylist é todo seu até ${end}.`,
    intro: 'Veja o que já está liberado para você:',
    button: 'Abrir meu estúdio',
    then: (monthly: string) => `Depois, ${monthly} por mês`,
    renews: (end: string) => `Seu plano se renova a partir de ${end}, e todo mês depois disso, até você cancelar.`,
    paid: (trial: string, end: string) =>
      `Hoje você pagou ${trial}. Cancele quando quiser antes de ${end}, nas configurações da sua conta, e nada mais será cobrado. Vamos lembrar você dois dias antes.`,
  },

  trialEnding: {
    subject: (end: string) => `Seu teste do Pro vai até ${end}`,
    preheader: (monthly: string, looks: number) =>
      `Depois, ${monthly} por mês por ${looks} looks novos, seus relatórios e mais. Cancele antes, se preferir não continuar.`,
    eyebrow: 'Um lembrete sobre seu teste',
    heading: (end: string) => `Seu teste vai até ${end}.`,
    body: (end: string, monthly: string, looks: number, left: number) =>
      `A partir de ${end}, seu plano Avarobe Pro se renova no valor de ${monthly} por mês. Continue e nada muda: ${looks} looks novos todo mês em você, seus relatórios de cores e de estilo, provador virtual e todos os cortes de cabelo.` +
      (left > 0 ? (left === 1 ? ' Você ainda tem 1 look para usar.' : ` Você ainda tem ${left} looks para usar.`) : ''),
    button: 'Continuar montando looks',
    cancel: (end: string, annual: string, perMonth: string) =>
      `Prefere não continuar? Cancele nas configurações da sua conta antes de ${end}, e nada será cobrado. Prefere um ano? O Pro anual custa ${annual} (${perMonth}/mês) e mantém os dois relatórios para sempre.`,
  },

  guide: {
    subject: 'Seu Livro de Fórmulas de Looks chegou',
    preheader: '120 fórmulas de looks, prontas para baixar. Seu link funciona sempre.',
    receipt: 'O Livro de Fórmulas de Looks',
    heading: 'Seu guia está pronto.',
    intro:
      'Obrigado pelo seu pedido. Seu exemplar de O Livro de Fórmulas de Looks está pronto: 120 combinações que sempre funcionam, o método Cor, Forma e Acabamento, um guia rápido de pares de cores e planners para imprimir.',
    button: 'Baixar meu guia (PDF)',
    keep: 'Salve no celular ou imprima. Este link é seu e funciona sempre, então guarde este e-mail.',
    colors: 'Quer saber quais dessas cores são suas? O Avarobe descobre sua estação de cores a partir de uma selfie, grátis.',
  },

  magazine: {
    subject: (name: string) => (name ? `${name}, sua revista está pronta` : 'Sua revista está pronta'),
    preheader: 'Sua capa, uma carta do seu stylist e dez looks em você, em locações.',
    receipt: 'sua revista personalizada',
    heading: 'Sua edição saiu.',
    intro:
      'Sua revista está pronta: sua própria capa, uma carta do seu stylist e dez looks em você, em locações, com o porquê de cada um funcionar e as peças para encontrar.',
    button: 'Ler minha revista',
    keep: 'Abra no celular ou no computador. De lá, você pode salvar em PDF e guardar.',
  },

  crossSell: {
    styleFeatures: [
      'Seu arquétipo de estilo, em palavras que ajudam na hora de comprar',
      'Silhuetas e decotes provados no seu próprio avatar, com os que valorizam você marcados',
      'Um guia de caimento: os comprimentos, as alturas de cós e as cinturas que funcionam em você',
      'Um armário-cápsula de 12 peças nas suas cores e formas',
    ],
    hairFeatures: [
      'O formato do seu rosto e seu tipo de cabelo, e o que eles significam para o seu corte',
      'Seis cortes de cabelo escolhidos para você, cada um na sua própria foto',
      'O briefing para seu cabeleireiro, na linguagem do salão',
      'As cores de cabelo que valorizam sua pele (ou, para moda masculina, os estilos de barba que combinam com seu maxilar)',
    ],
    magazineFeatures: [
      'Sua própria capa, com seu nome como título da revista',
      'Uma carta do seu stylist sobre suas cores e formas',
      'Dez looks em você, em locações, um para cada momento que você escolher',
      'Por que cada look funciona, e as peças para encontrar',
    ],
    eventFeatures: [
      'Três looks completos para o dress code do evento, em você',
      'Cada peça encontrada em lojas, dentro do seu orçamento',
      'Sapatos, bolsas, cabelo e maquiagem para completar cada look',
      'Um checklist para o dia',
    ],
    // No Thanksgiving or fall weddings in Brazil (spring there).
    upcoming: {
      october: 'As festas de Halloween e os casamentos estão chegando.',
      november: 'As primeiras festas de fim de ano estão chegando.',
      december: 'As festas de fim de ano e o Réveillon estão chegando.',
      other: 'Um casamento, uma entrevista, uma saída à noite?',
    },
    pairPrice: (regular: string, owned: string, ends: string) => `Em vez de ${regular}, porque você tem o ${owned}. Vale até ${ends}.`,
    forYou: 'Para você, nas suas próprias fotos.',
    pairTail: (price: string, regular: string, ends: string) => `${price} em vez de ${regular} para você, até ${ends}.`,
    onceTail: (price: string) => `${price}, uma vez só.`,
    getMy: (name: string, price: string) => `Quero meu ${name} · ${price}`,
    gift: {
      occasion: 'Um passeio',
      notes: (color: string, hex: string) => `Monte o look inteiro em torno de ${color} (${hex}): essa é a peça principal.`,
    },
    proFeatures: (looks: number) => [
      'Um Edit novo toda semana, com cada look provado em você em um toque',
      `${looks} looks por mês para tudo o que estiver na sua agenda, mostrados em você`,
      'Prove qualquer look a partir de uma foto, no seu próprio avatar',
      'Os três consultores enquanto você tiver o Pro: suas cores, suas formas e todos os cortes de cabelo',
    ],
    proDetail: 'Um Edit novo toda semana, provado em você.',

    style: {
      subject: 'Você já conhece suas cores. Agora veja suas formas.',
      preheader: (tail: string) => `O Consultor de Estilo prova silhuetas e decotes no seu próprio avatar. ${tail}`,
      eyebrow: 'Seu próximo consultor',
      intro:
        'Seu Consultor de Cores mostra as cores que iluminam seu rosto. O Consultor de Estilo faz o mesmo pelo seu corpo: ele lê suas proporções e depois prova silhuetas e decotes no seu próprio avatar, para você ver o que valoriza você e por quê.',
      colorsCaption: 'Suas cores. O Consultor de Estilo as leva para as modelagens que combinam com você.',
      more: 'Aproveite mais suas cores',
      palette: 'Minha paleta',
      mirror: 'O espelho de cores',
      check: 'Essa cor fica bem em mim?',
      giftSubject: (color: string) => `Montamos um look em torno da sua cor nº 1: ${color}`,
      giftPreheader: (tail: string) => `Ele já está nos seus looks, em você. O próximo passo: as modelagens que valorizam você. ${tail}`,
      giftEyebrow: 'Um look para você',
      giftIntro:
        'É um presente, e ele já está nos seus looks: um look completo para um passeio, montado em torno da cor que ilumina seu rosto. Seu Consultor de Cores encontrou essa cor. O Consultor de Estilo faz o mesmo pelo seu corpo: ele lê suas proporções e prova silhuetas e decotes no seu próprio avatar, para você ver o que valoriza você e por quê.',
      giftLink: 'Abrir meu look de presente',
      giftAlt: (color: string) => `Você, em um look montado em torno de ${color}`,
    },
    color: {
      subjectAfterStyle: 'Você já conhece suas formas. Agora descubra suas cores.',
      subject: 'As cores que iluminam seu rosto',
      preheader: (tail: string) => `Tudo o que uma análise de coloração pessoal mostraria, a partir de uma selfie, no seu próprio rosto. ${tail}`,
      heading: 'Descubra as cores que iluminam seu rosto.',
      introAfterStyle:
        'Seu Consultor de Estilo mostra as formas que valorizam você. O Consultor de Cores descobre as cores que iluminam seu rosto, a partir de uma selfie, e mostra cada uma delas em você.',
      intro: 'O Consultor de Cores descobre suas cores a partir de uma selfie: tudo o que uma análise de coloração pessoal mostraria, no seu próprio rosto.',
      photoSubject: 'Seu melhor lado continua desfocado',
      photoPreheader: (tail: string) =>
        `É a sua própria foto, nas cores lidas da sua selfie. O Consultor de Cores mostra todas elas em você. ${tail}`,
      photoHeading: 'Seu melhor lado fica desfocado até você abrir seu Consultor de Cores.',
      photoIntro:
        'Essa é a sua própria foto, nas cores lidas da sua selfie. A parte desfocada é você nas suas melhores cores, as que iluminam seu rosto. O Consultor de Cores mostra cada uma delas em você: sua cor nº 1, mais de 30 outras, seus neutros e as cores que devem ficar longe do rosto.',
      photoAlt: 'Sua foto: suas melhores cores, desfocadas até você abrir seu Consultor de Cores, ao lado da cor que apaga você',
    },
    lastCall: {
      subject: (name: string, price: string, weekday: string) => `Seu ${name} por ${price} só até ${weekday}`,
      preheader: (owned: string, price: string, regular: string, ends: string) =>
        `Como você já tem o ${owned}: ${price} em vez de ${regular}, até ${ends}.`,
      eyebrow: 'Última chamada',
      heading: (weekday: string) => `Seu preço especial vale só até ${weekday}.`,
      body: (owned: string, name: string, price: string, regular: string, ends: string) =>
        `Como você já tem o ${owned}, seu ${name} sai por ${price} em vez de ${regular}. Esse preço vale até ${ends}; depois, volta a ser ${regular}.`,
    },
    hair: {
      subject: 'Veja seu próximo corte antes de fazer',
      preheader: (price: string) =>
        `Seis cortes escolhidos para o seu rosto, na sua própria foto, e as cores de cabelo que combinam com você. ${price}, uma vez só.`,
      heading: 'Veja seu próximo corte antes de fazer.',
      introSeason: (season: string) =>
        `Seu cabelo emoldura seu rosto tanto quanto qualquer roupa. Para quem é ${season}, algumas cores de cabelo iluminam e outras apagam. O Consultor de Cabelo e Barba lê o formato do seu rosto e seu tipo de cabelo a partir de uma selfie e mostra os cortes e as cores que combinam com você, em você.`,
      intro:
        'Seu cabelo emoldura seu rosto tanto quanto qualquer roupa. O Consultor de Cabelo e Barba lê o formato do seu rosto e seu tipo de cabelo a partir de uma selfie e mostra os cortes e as cores de cabelo que combinam com você, em você.',
      detail: 'Cada corte escolhido para você, na sua própria foto.',
      cutSubject: 'Seu corte ideal, em você',
      cutPreheader: (price: string) =>
        `Colocamos na sua foto o corte que mais combina com o seu rosto. Outros cinco estão esperando, com o que dizer ao seu cabeleireiro. ${price}, uma vez só.`,
      cutHeading: (cut: string) => `Seu corte ideal: ${cut}.`,
      cutIntro:
        'Lemos o formato do seu rosto e seu tipo de cabelo a partir da sua selfie e colocamos na sua própria foto o corte que mais combina com você. Ele é seu, de graça, no seu estúdio.',
      cutMore:
        'O Consultor de Cabelo e Barba mostra os outros cinco cortes escolhidos para você, cada um em você, o briefing para seu cabeleireiro na linguagem do salão e as cores de cabelo que iluminam seu rosto (ou, para moda masculina, os estilos de barba que combinam com seu maxilar).',
      cutAlt: (cut: string) => `Você com seu corte ideal: ${cut}`,
    },
    pro: {
      subjectPhoto: (edit: string) => `Provamos o ${edit} em você`,
      subject: 'Uma coleção nova toda semana, provada em você',
      preheader: (price: string, looks: number) =>
        `Avarobe Pro: um Edit novo toda semana no seu avatar, ${looks} looks por mês e provas a partir de fotos. ${price} por mês, cancele quando quiser.`,
      eyebrow: 'Avarobe Pro',
      headingPhoto: (edit: string) => `Provamos o ${edit} em você.`,
      heading: 'Uma coleção nova toda semana, provada em você.',
      introPhoto: (edit: string) =>
        `Esse é o primeiro look do ${edit}, a coleção desta semana, em você. Com o Avarobe Pro, você prova cada look dele, e de cada Edit que vier depois, em um toque.`,
      intro: (edit: string | null) =>
        edit
          ? `Toda semana tem um Edit novo para provar. Nesta semana é o ${edit}. Com o Avarobe Pro, cada look dele aparece no seu próprio avatar em um toque.`
          : 'Toda semana tem um Edit novo para provar, dos casamentos às festas de fim de ano. Com o Avarobe Pro, cada look aparece no seu próprio avatar em um toque.',
      button: (price: string) => `Quero o Avarobe Pro · ${price}/mês`,
      alt: (edit: string) => `Você, em um look do ${edit}`,
    },
    edit: {
      subjectPhoto: (edit: string) => `O ${edit} acabou de chegar, e aqui está ele em você`,
      subject: (edit: string) => `O ${edit} acabou de chegar`,
      eyebrow: 'Novidade da semana',
      introPhoto:
        'Esse é o primeiro look dele, provado no seu avatar. Com o Avarobe Pro, você prova cada look dele, e um Edit novo toda semana depois dele.',
      intro: 'Com o Avarobe Pro, cada look dele aparece no seu próprio avatar em um toque, e um Edit novo chega toda semana.',
    },
    magazine: {
      subject: (name: string) => (name ? `${name}, você na capa` : 'Você, na capa'),
      preheader: (price: string) =>
        `Sua revista personalizada: dez looks em você, em locações, nas suas cores, com sua própria capa. ${price}, uma vez só.`,
      heading: 'Uma revista sobre você, com você na capa.',
      intro:
        'Escolha os momentos da sua temporada (um brunch, um grande dia no trabalho, um casamento, uma viagem), e nós montamos um look para cada um e fotografamos em você, em locações. Depois escrevemos tudo: sua capa, uma carta do seu stylist e por que cada look funciona.',
      colorsCaption: 'Cada look da sua edição é planejado nas suas cores.',
      detail: 'Uma edição, cerca de cinco minutos depois que você escolhe seus momentos.',
      button: (price: string) => `Criar minha revista · ${price}`,
      coverSubject: (name: string) => (name ? `${name}, na capa` : 'Você, na capa'),
      coverPreheader: (price: string) =>
        `Fizemos a sua capa. Sua revista personalizada é a edição inteira: dez looks em você, em locações. ${price}, uma vez só.`,
      coverHeading: 'Sua capa está pronta. A edição é sua para criar.',
      coverIntro:
        'Fizemos esta capa a partir da sua foto. Sua revista personalizada é a edição inteira: escolha os momentos da sua temporada (um brunch, um grande dia no trabalho, um casamento, uma viagem), e nós montamos um look para cada um e fotografamos em você, em locações. Depois escrevemos tudo: uma carta do seu stylist e por que cada look funciona.',
      issue: (season: string | null, month: string) => (season ? `Edição ${season} · ${month}` : `Sua edição · ${month}`),
      coverAlt: 'Uma capa de revista com você, e seu nome como título',
    },
    event: {
      subject: 'Tem algum evento chegando?',
      preheader: (price: string) =>
        `Escolha o evento: três looks completos para o dress code, em você, com cada peça encontrada em lojas. ${price} por evento.`,
      heading: 'Tem algum evento chegando?',
      introPhoto: (upcoming: string) =>
        `Esse é o seu look mais recente, em você. ${upcoming} Escolha o evento e o Stylist de Eventos monta três looks completos para o dress code, em você, com cada peça disponível em lojas e como finalizar o visual.`,
      intro: (upcoming: string) =>
        `${upcoming} Escolha o evento e o Stylist de Eventos monta três looks completos para o dress code, mostrados em você, com cada peça disponível em lojas e como finalizar o visual.`,
      occasions: [
        { label: 'Casamento', occasion: 'Um casamento' },
        { label: 'Evento de trabalho', occasion: 'Um evento de trabalho' },
        { label: 'Encontro', occasion: 'Um encontro' },
      ],
      pick: 'Cada um abre o Stylist de Eventos já com sua conta conectada e com seu evento preenchido.',
      detail: 'Três looks completos para um evento, em você.',
      lookAlt: 'Você, no seu look mais recente',
    },
    guide: {
      subject: '120 fórmulas de looks que sempre funcionam',
      preheader: (price: string) =>
        `O Livro de Fórmulas de Looks: 120 combinações, o método Cor, Forma e Acabamento e planners para imprimir. Um PDF de ${price}, para sempre seu.`,
      heading: 'Chega de olhar para o armário cheio sem saber o que vestir.',
      introSeason: (season: string) =>
        `Sua paleta de ${season} diz quais cores são suas. O Livro de Fórmulas de Looks mostra como combiná-las: 120 combinações de looks que sempre funcionam, o método Cor, Forma e Acabamento, um guia rápido de pares de cores e planners para imprimir.`,
      intro:
        'O Livro de Fórmulas de Looks: 120 combinações de looks que sempre funcionam, o método Cor, Forma e Acabamento, um guia rápido de pares de cores e planners para imprimir.',
      detail: 'Um PDF, para sempre seu.',
      delivery: 'Pagamento único. Download imediato, e também enviamos por e-mail.',
      button: (price: string) => `Quero o livro · ${price}`,
      paletteHeading: '120 fórmulas de looks, e aqui está a sua paleta para usar com elas.',
      paletteCaption: 'Suas cores. Cada fórmula do livro funciona com elas.',
      language: 'O livro é em inglês.',
    },
  },

  auth: {
    hi: (name: string) => `Olá, ${name},`,
    hiAnonymous: 'Olá,',
    pasteLink: 'Ou cole este link no seu navegador:',
    linkOnce24h: 'O link funciona uma vez e expira em 24 horas.',
    linkOnce3d: 'O link funciona uma vez e expira em 3 dias.',
    confirmEmail: 'Confirmar meu e-mail',
    nothingElse: 'Se foi você, não precisa fazer mais nada.',
    verification: {
      subject: 'Confirme seu e-mail no Avarobe',
      passkey:
        'Confirme que este é o seu e-mail para terminar de criar sua conta Avarobe. Logo depois, você vai configurar uma passkey para entrar com Face ID, Touch ID ou o PIN do seu dispositivo.',
      password: 'Confirme que este é o seu e-mail. Assim você pode adicionar passkeys e recuperar sua conta se esquecer a senha.',
      footer: 'Não se cadastrou no Avarobe? Pode ignorar este e-mail.',
    },
    saved: {
      subject: 'Suas cores no Avarobe estão salvas',
      paragraphs: [
        'Suas cores e tudo o que você criar no Avarobe estão salvos neste e-mail. Confirme pelo botão abaixo.',
        'Não há senha para lembrar: quando quiser voltar, peça um link de acesso na página de login do Avarobe e enviamos um por e-mail. O link abaixo funciona uma vez e expira em 24 horas.',
      ],
      footer: 'Não usou o Avarobe? Pode ignorar este e-mail.',
      colorsSubject: (season: string) => `Suas cores: ${season}`,
      colorsDrape: (season: string) =>
        `Sua estação é ${season}. Acima está o seu teste de tecidos no seu próprio rosto: a cor que deve ficar longe dele, ao lado das suas melhores cores, que esperam por você no relatório de cores completo.`,
      colorsSeason: (season: string) =>
        `Sua estação é ${season}. Suas melhores cores no seu próprio rosto esperam por você no relatório de cores completo.`,
      colorsKeep:
        'Suas cores estão salvas neste e-mail. Confirme pelo botão abaixo e volte quando quiser: não há senha, enviamos um link de acesso sempre que você pedir. Este funciona uma vez e expira em 24 horas.',
      colorsCta: 'Confirmar e ver minhas cores',
      colorsAlt: 'Seu teste de tecidos: uma cor para manter longe do rosto, ao lado das suas melhores cores, bloqueadas',
    },
    signIn: {
      subject: 'Seu link de acesso ao Avarobe',
      intro: 'Aqui está seu link para entrar no Avarobe.',
      button: 'Entrar no Avarobe',
      footer: 'Não pediu isso? Pode ignorar este e-mail; ninguém consegue entrar sem o link.',
    },
    continueInBrowser: {
      subject: 'Seu link para abrir o Avarobe no navegador',
      intro:
        'Aqui está seu link para abrir o Avarobe no navegador do seu celular, já com sua conta conectada. Lá você pode pagar com Apple Pay ou com um cartão salvo.',
      button: 'Abrir o Avarobe',
      footer: 'Não pediu isso? Pode ignorar este e-mail.',
    },
    passwordReset: {
      subject: 'Redefina sua senha do Avarobe',
      paragraphs: [
        'Recebemos um pedido para redefinir a senha deste e-mail. Escolha uma nova pelo botão abaixo.',
        'O link funciona uma vez e expira em 1 hora. A redefinição desconecta você de todos os dispositivos e remove suas passkeys, para que você possa adicioná-las de novo com segurança.',
      ],
      button: 'Escolher uma nova senha',
      footer: 'Não pediu isso? Ignore este e-mail e sua senha continua a mesma.',
    },
    passwordChanged: {
      subject: 'Sua senha do Avarobe foi alterada',
      intro: 'A senha da sua conta Avarobe acabou de ser alterada.',
      button: 'Não fui eu: redefinir minha senha',
    },
    passkeyAdded: {
      subject: 'Uma passkey foi adicionada à sua conta Avarobe',
      added: (device: string) => `Uma passkey de "${device}" agora pode entrar na sua conta Avarobe.`,
      notYou: 'Se não foi você, remova-a nas configurações da sua conta e redefina sua senha.',
      button: 'Revisar minhas passkeys',
    },
  },
}
