import { config } from './config';
import { OllamaUnavailableError } from './errors';
import type { ChatMessage } from './types';

interface EmbedResponse {
  embeddings: number[][];
}

interface ChatResponse {
  message?: { content?: string };
}

function isConnectionError(e: unknown): boolean {
  return e instanceof Error && /fetch failed|ECONNREFUSED|connect/i.test(e.message);
}

async function post<T>(endpoint: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.ollama.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.ollama.requestTimeoutMs),
    });
  } catch (e) {
    if (isConnectionError(e) || (e instanceof Error && e.name === 'TimeoutError')) {
      throw new OllamaUnavailableError(
        'Ollama no responde en ' + config.ollama.baseUrl + '. ¿Está corriendo? Ejecuta: ollama serve',
      );
    }
    throw e;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new OllamaUnavailableError(`Ollama respondió ${response.status} en ${endpoint}: ${text.substring(0, 200)}`);
  }
  return (await response.json()) as T;
}

/** Embedding de un texto individual. */
export async function embed(text: string): Promise<number[]> {
  const data = await post<EmbedResponse>('/api/embed', {
    model: config.ollama.embedModel,
    input: text,
  });
  return data.embeddings[0];
}

/** Embeddings por lotes (un solo POST con array de inputs). */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const data = await post<EmbedResponse>('/api/embed', {
    model: config.ollama.embedModel,
    input: texts,
  });
  if (data.embeddings.length !== texts.length) {
    throw new OllamaUnavailableError(
      `Ollama devolvió ${data.embeddings.length} embeddings para ${texts.length} textos`,
    );
  }
  return data.embeddings;
}

export interface ChatOptions {
  temperature?: number;
  numPredict?: number;
}

/** Chat con el modelo principal (sin streaming). */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const data = await post<ChatResponse>('/api/chat', {
    model: config.ollama.chatModel,
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.2,
      ...(options.numPredict ? { num_predict: options.numPredict } : {}),
    },
  });
  return data.message?.content ?? '';
}

/**
 * Chat con streaming: invoca onToken con cada fragmento de texto generado.
 * Parsea el NDJSON de /api/chat (un objeto JSON por línea).
 */
export async function chatStream(
  messages: ChatMessage[],
  onToken: (token: string) => void,
  options: ChatOptions = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.chatModel,
        messages,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.2,
          ...(options.numPredict ? { num_predict: options.numPredict } : {}),
        },
      }),
      signal: AbortSignal.timeout(config.ollama.requestTimeoutMs),
    });
  } catch (e) {
    if (isConnectionError(e) || (e instanceof Error && e.name === 'TimeoutError')) {
      throw new OllamaUnavailableError(
        'Ollama no responde en ' + config.ollama.baseUrl + '. ¿Está corriendo? Ejecuta: ollama serve',
      );
    }
    throw e;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new OllamaUnavailableError(`Ollama respondió ${response.status} en /api/chat: ${text.substring(0, 200)}`);
  }
  if (!response.body) {
    throw new OllamaUnavailableError('Ollama no devolvió body en streaming');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Procesar líneas completas; conservar el resto en el buffer
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const content = obj.message?.content;
          if (content) onToken(content);
        } catch {
          // Línea parcial o no-JSON: ignorar (el modelo a veces manda keep-alives)
        }
      }
    }

    // Resto final sin newline
    const tail = buffer.trim();
    if (tail) {
      try {
        const obj = JSON.parse(tail) as { message?: { content?: string } };
        if (obj.message?.content) onToken(obj.message.content);
      } catch {
        /* ignorar */
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Puntúa la relevancia de una lista de fragmentos para una pregunta (0-10).
 * Una sola llamada al modelo judge; devuelve un score por fragmento.
 * Si el parseo falla, devuelve null (el llamador decide el fallback).
 */
export async function judgeRelevance(question: string, docs: string[]): Promise<number[] | null> {
  if (docs.length === 0) return [];

  const docList = docs
    .map((d, i) => {
      const trimmed = d.length > 1500 ? d.substring(0, 1500) + '…' : d;
      return `[${i + 1}] ${trimmed}`;
    })
    .join('\n\n');

  const system =
    'Eres un evaluador de relevancia para un sistema de búsqueda. ' +
    'Puntúas del 0 al 10 qué tan útil es cada fragmento para responder la pregunta. ' +
    '0 = totalmente irrelevante, 10 = responde directamente. ' +
    'Responde ÚNICAMENTE con JSON válido, sin texto adicional.';

  const user =
    `PREGUNTA: ${question}\n\n` +
    `FRAGMENTOS:\n${docList}\n\n` +
    `Responde solo con: {"scores": [<score1>, <score2>, ..., <score${docs.length}>]}`;

  let raw: string;
  try {
    raw = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0, numPredict: 120 },
    );
  } catch {
    return null;
  }

  return parseScores(raw, docs.length);
}

function parseScores(raw: string, expected: number): number[] | null {
  // Buscar el primer objeto JSON que contenga "scores"
  const match = raw.match(/\{[^{}]*"scores"[^{}]*\}/s);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { scores?: unknown };
    if (!Array.isArray(parsed.scores)) return null;
    const scores = parsed.scores.map((s) => {
      const n = typeof s === 'number' ? s : parseFloat(String(s));
      return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
    });
    if (scores.length !== expected) return null;
    return scores;
  } catch {
    return null;
  }
}

/** Comprueba si Ollama está disponible. */
export async function isAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
