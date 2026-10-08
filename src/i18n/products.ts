import type { PurchaseProduct } from '../types/mongo.js'
import type { Locale } from '../utils/locale.js'

type ProductCopy = { name: string; description: string }

// What Stripe's checkout and the account's purchase list call each product
// in Portuguese and Spanish. English is in billing/stripe.ts (PRODUCTS).
// Checkout already shows "Avarobe" at the top, so the names go without it.
export const PRODUCT_COPY: Record<Exclude<Locale, 'en'>, Record<PurchaseProduct, ProductCopy>> = {
  'pt-BR': {
    color_report: {
      name: 'Consultor de Cores',
      description: 'Sua cartela completa e um relatório visual de cores no seu próprio rosto: teste de tecidos, painéis e guias.',
    },
    style_report: {
      name: 'Consultor de Estilo',
      description: 'Seu perfil de estilo: as modelagens, os decotes e as peças que valorizam você, no seu avatar.',
    },
    reports_bundle: {
      name: 'Consultores de Cores e Estilo',
      description: 'Os dois relatórios: seu relatório de cores completo e seu perfil de estilo.',
    },
    color_addon: {
      name: 'Consultor de Cores (completa seu conjunto)',
      description: 'O Consultor de Cores pelo preço do combo, com o seu Consultor de Estilo descontado.',
    },
    style_addon: {
      name: 'Consultor de Estilo (completa seu conjunto)',
      description: 'O Consultor de Estilo pelo preço do combo, com o seu Consultor de Cores descontado.',
    },
    color_mirror: {
      name: 'Espelho de Cores',
      description: 'Cada tecido sob o seu rosto, ao vivo na sua câmera, com a sua cor nº 1 e o que cada cor faz por você.',
    },
    hair_advisor: {
      name: 'Consultor de Cabelo e Barba',
      description: 'Cada corte escolhido para o seu rosto, em você, com o que pedir ao cabeleireiro e as cores de cabelo que combinam com você.',
    },
    advisors_bundle: {
      name: 'Os três consultores',
      description: 'Cores com o espelho ao vivo, seu perfil de estilo e cada corte em você.',
    },
    outfit_guide: {
      name: 'O Livro de Fórmulas de Looks',
      description: '120 fórmulas de looks que sempre funcionam, com o método Cor, Forma e Acabamento. Um guia em PDF, em inglês, para sempre seu.',
    },
    event_pass: {
      name: 'Stylist de Eventos',
      description: 'Um evento resolvido: três looks em você para o dress code, as peças nas lojas e como finalizar.',
    },
    magazine: {
      name: 'Sua revista personalizada',
      description: 'Sua própria revista: uma capa, uma carta do seu stylist e dez looks em você, em cenários reais, nas suas cores.',
    },
    look_pack: {
      name: 'Pacote de looks',
      description: 'Mais looks para as suas ocasiões. Eles nunca expiram.',
    },
    pro_monthly: {
      name: 'Avarobe Pro (mensal)',
      description: 'Looks novos todo mês, seus relatórios de cores e estilo, provas virtuais, cada peça nas lojas e mais.',
    },
    pro_annual: {
      name: 'Avarobe Pro (anual)',
      description: 'Tudo do Pro por um ano, com seus Consultores de Cores e Estilo incluídos.',
    },
    pro_trial: {
      name: 'Teste do Avarobe Pro',
      description: 'Seus primeiros dias de Avarobe Pro. Depois, mensal, até você cancelar.',
    },
  },
  es: {
    color_report: {
      name: 'Asesor de Color',
      description: 'Tu paleta completa y un reporte visual de color en tu propio rostro: prueba de telas, tableros y guías.',
    },
    style_report: {
      name: 'Asesor de Estilo',
      description: 'Tu perfil de estilo: los cortes, escotes y prendas que te favorecen, en tu avatar.',
    },
    reports_bundle: {
      name: 'Asesores de Color y Estilo',
      description: 'Los dos reportes: tu reporte de color completo y tu perfil de estilo.',
    },
    color_addon: {
      name: 'Asesor de Color (completa tu set)',
      description: 'El Asesor de Color al precio del paquete, con tu Asesor de Estilo descontado.',
    },
    style_addon: {
      name: 'Asesor de Estilo (completa tu set)',
      description: 'El Asesor de Estilo al precio del paquete, con tu Asesor de Color descontado.',
    },
    color_mirror: {
      name: 'Espejo de Color',
      description: 'Cada tela bajo tu rostro, en vivo en tu cámara, con tu color nº 1 y lo que cada color hace por ti.',
    },
    hair_advisor: {
      name: 'Asesor de Cabello y Barba',
      description: 'Cada corte elegido para tu rostro, en ti, con lo que debes pedirle a tu estilista y los colores de cabello que te van.',
    },
    advisors_bundle: {
      name: 'Los tres asesores',
      description: 'Tus colores con el espejo en vivo, tu perfil de estilo y cada corte en ti.',
    },
    outfit_guide: {
      name: 'El Libro de Fórmulas de Outfits',
      description: '120 fórmulas de outfits que siempre funcionan, con el método Color, Forma y Acabado. Una guía en PDF, en inglés, tuya para siempre.',
    },
    event_pass: {
      name: 'Estilista de Eventos',
      description: 'Un evento resuelto: tres looks en ti para su código de vestimenta, las prendas en tiendas y cómo rematarlos.',
    },
    magazine: {
      name: 'Tu revista personal',
      description: 'Tu propia revista: una portada, una carta de tu estilista y diez looks en ti, en locación, en tus colores.',
    },
    look_pack: {
      name: 'Paquete de looks',
      description: 'Más looks para tus ocasiones. Nunca vencen.',
    },
    pro_monthly: {
      name: 'Avarobe Pro (mensual)',
      description: 'Looks nuevos cada mes, tus reportes de color y estilo, pruebas virtuales, cada prenda en tiendas y más.',
    },
    pro_annual: {
      name: 'Avarobe Pro (anual)',
      description: 'Todo Pro por un año, con tus Asesores de Color y Estilo incluidos.',
    },
    pro_trial: {
      name: 'Prueba de Avarobe Pro',
      description: 'Tus primeros días de Avarobe Pro. Después, mensual, hasta que canceles.',
    },
  },
}
