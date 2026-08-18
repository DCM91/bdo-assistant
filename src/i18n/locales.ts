/**
 * Localizaciones para prompts del LLM y mensajes que cruzan main/renderer.
 *
 * IMPORTANTE: el renderer (src/ui/renderer/renderer.ts) tiene una copia DUPLICADA
 * de este objeto porque `tsconfig.renderer.json` usa `module: none` y los rootDirs
 * no permiten importar desde `src/`. Si modificas las claves aquí, también debes
 * mantener sincronizada la constante `TR` en renderer.ts.
 */
export type Locale = 'es' | 'en' | 'pt';

export const SUPPORTED_LOCALES: readonly Locale[] = ['es', 'en', 'pt'];
export const DEFAULT_LOCALE: Locale = 'es';

export const LOCALE_LABELS: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
};

type Translations = Record<string, string>;

export const TRANSLATIONS: Record<Locale, Translations> = {
  // ============================================================
  // ESPAÑOL
  // ============================================================
  es: {
    'query.emptyResult':
      'No encontré información relevante en las fuentes indexadas para tu pregunta. Prueba reformularla o ejecuta /scrape para ampliar la base de datos.',
    'query.fallbackAnswer': 'No se pudo generar una respuesta.',
    'query.systemPrompt':
      'Eres un asistente experto en Black Desert Online (BDO). ' +
      'Responde ÚNICAMENTE basándote en la información proporcionada a continuación. ' +
      'REGLAS OBLIGATORIAS:\n' +
      '- Cada afirmación importante debe terminar con la cita de su fuente: [ref:N] (N = número de fuente).\n' +
      '- Si la información no es suficiente para responder, dilo claramente en lugar de inventar.\n' +
      '- Menciona la fecha de los datos cuando sea relevante.\n' +
      '- Responde en español, de forma clara y directa.',
    'query.userPromptBefore': 'INFORMACIÓN DISPONIBLE:',
    'query.userPromptQuestion': 'PREGUNTA:',
    'query.userPromptAfter':
      'RESPUESTA (basada solo en la información anterior, en español, con citas [ref:N]):',
  },

  // ============================================================
  // ENGLISH
  // ============================================================
  en: {
    'query.emptyResult':
      'I could not find relevant information in the indexed sources for your question. Try rephrasing or run /scrape to expand the database.',
    'query.fallbackAnswer': 'Could not generate a response.',
    'query.systemPrompt':
      'You are an expert assistant for Black Desert Online (BDO). ' +
      'Respond ONLY based on the information provided below. ' +
      'MANDATORY RULES:\n' +
      '- Each important claim must end with its source citation: [ref:N] (N = source number).\n' +
      '- If the information is not enough to answer, say so clearly instead of inventing.\n' +
      '- Mention the data date when relevant.\n' +
      '- Respond in English, clearly and directly.',
    'query.userPromptBefore': 'AVAILABLE INFORMATION:',
    'query.userPromptQuestion': 'QUESTION:',
    'query.userPromptAfter':
      'ANSWER (based only on the information above, in English, with citations [ref:N]):',
  },

  // ============================================================
  // PORTUGUÊS
  // ============================================================
  pt: {
    'query.emptyResult':
      'Não encontrei informação relevante nas fontes indexadas para sua pergunta. Tente reformular ou execute /scrape para expandir a base de dados.',
    'query.fallbackAnswer': 'Não foi possível gerar uma resposta.',
    'query.systemPrompt':
      'Você é um assistente especialista em Black Desert Online (BDO). ' +
      'Responda SOMENTE com base nas informações fornecidas abaixo. ' +
      'REGRAS OBRIGATÓRIAS:\n' +
      '- Cada afirmação importante deve terminar com a citação da fonte: [ref:N] (N = número da fonte).\n' +
      '- Se a informação não for suficiente para responder, diga claramente em vez de inventar.\n' +
      '- Mencione a data dos dados quando for relevante.\n' +
      '- Responda em português, de forma clara e direta.',
    'query.userPromptBefore': 'INFORMAÇÕES DISPONÍVEIS:',
    'query.userPromptQuestion': 'PERGUNTA:',
    'query.userPromptAfter':
      'RESPOSTA (baseada apenas nas informações acima, em português, com citações [ref:N]):',
  },
};