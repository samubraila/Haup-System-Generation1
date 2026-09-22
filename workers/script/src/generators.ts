import { z } from 'zod';

export interface Scene {
  index: number;
  prompt: string;
  narration: string;
  durationSec: number;
  keywords: string[];
}

const KEYWORD_STOPWORDS = new Set([
  'der', 'die', 'das', 'und', 'oder', 'mit', 'von', 'fuer', 'ein', 'eine', 'einen', 'dem', 'den',
  'the', 'and', 'with', 'from', 'for', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'about',
]);

export function extractKeywords(text: string, limit = 3): string[] {
  const words = text.match(/\p{L}{4,}/gu) ?? [];
  const picked: string[] = [];
  for (const word of words) {
    const lowered = word.toLowerCase();
    if (KEYWORD_STOPWORDS.has(lowered)) continue;
    if (picked.some((entry) => entry.toLowerCase() === lowered)) continue;
    picked.push(word);
    if (picked.length >= limit) break;
  }
  return picked;
}

export interface ScriptDraft {
  title: string;
  hook: string;
  body: string;
  scenes: Scene[];
  wordCount: number;
  estimatedDurationSec: number;
  provider: string;
  language: string;
}

export interface ScriptRequest {
  title: string;
  topic: string;
  description: string;
  language: string;
  style: string;
  durationSec: number;
  format: string;
  guidance: string;
  sceneCount: number;
}

const WORDS_PER_SECOND: Record<string, number> = {
  de: 2.3,
  en: 2.6,
  es: 2.7,
  fr: 2.4,
  it: 2.5,
};

const SHOT_TYPES = [
  'weite Einstellung, langsame Kamerafahrt',
  'mittlere Einstellung, leichter Schwenk',
  'Detailaufnahme, geringe Schaerfentiefe',
  'Vogelperspektive, ruhige Bewegung',
  'dynamische Kamerafahrt nach vorne',
  'statische Einstellung, weiches Licht',
];

const LABELS: Record<string, { intro: string; main: string; outro: string }> = {
  de: { intro: 'Einstieg', main: 'Hauptteil', outro: 'Abschluss' },
  en: { intro: 'Intro', main: 'Main', outro: 'Outro' },
  es: { intro: 'Introduccion', main: 'Desarrollo', outro: 'Cierre' },
  fr: { intro: 'Introduction', main: 'Developpement', outro: 'Conclusion' },
  it: { intro: 'Introduzione', main: 'Sviluppo', outro: 'Chiusura' },
};

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateDuration(text: string, language: string): number {
  const wps = WORDS_PER_SECOND[language] ?? 2.4;
  return Math.round(countWords(text) / wps);
}

export function buildTemplateScript(request: ScriptRequest): ScriptDraft {
  const labels = LABELS[request.language] ?? LABELS.de!;
  const sceneCount = Math.max(2, Math.min(12, request.sceneCount));
  const perScene = Math.max(2, Math.round(request.durationSec / sceneCount));
  const subject = request.topic || request.title;

  const scenes: Scene[] = Array.from({ length: sceneCount }, (_, index) => {
    const position = index === 0 ? labels.intro : index === sceneCount - 1 ? labels.outro : `${labels.main} ${index}`;
    const shot = SHOT_TYPES[index % SHOT_TYPES.length];
    return {
      index,
      prompt: [subject, request.style, shot, request.guidance].filter(Boolean).join(', '),
      narration: `[${position}] ${subject}`,
      durationSec: perScene,
      keywords: extractKeywords(`${subject} ${request.description}`),
    };
  });

  const body = scenes.map((scene) => scene.narration).join('\n');

  return {
    title: request.title,
    hook: `${subject} - ${request.style}`,
    body,
    scenes,
    wordCount: countWords(body),
    estimatedDurationSec: perScene * sceneCount,
    provider: 'template',
    language: request.language,
  };
}

const ollamaSceneSchema = z.object({
  prompt: z.string().min(1),
  narration: z.string().default(''),
  durationSec: z.number().positive().optional(),
  keywords: z.array(z.string()).optional(),
});

const ollamaResponseSchema = z.object({
  title: z.string().optional(),
  hook: z.string().default(''),
  scenes: z.array(ollamaSceneSchema).min(1),
});

const LANGUAGE_NAMES: Record<string, string> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Espanol',
  fr: 'Francais',
  it: 'Italiano',
};

function buildPrompt(request: ScriptRequest): string {
  const languageName = LANGUAGE_NAMES[request.language] ?? 'Deutsch';
  const sceneCount = Math.max(2, Math.min(12, request.sceneCount));

  return [
    `Du schreibst ein Kurzvideo-Skript in ${languageName}.`,
    `Thema: ${request.topic || request.title}`,
    request.description ? `Zusatzinfo: ${request.description}` : '',
    `Stil: ${request.style}`,
    `Format: ${request.format}`,
    `Gesamtlaenge: ${request.durationSec} Sekunden, aufgeteilt in genau ${sceneCount} Szenen.`,
    request.guidance ? `Zusaetzliche Vorgabe: ${request.guidance}` : '',
    '',
    'Antworte ausschliesslich mit JSON in genau dieser Struktur:',
    '{"title": "...", "hook": "...", "scenes": [{"prompt": "englische Bildbeschreibung", "narration": "gesprochener Text", "durationSec": 5, "keywords": ["englisches", "stichwort"]}]}',
    '',
    'Regeln:',
    '- "narration" ist der gesprochene Text in der Zielsprache, kurz und praegnant.',
    '- "prompt" ist eine visuelle Beschreibung auf Englisch, ohne Text im Bild, ohne Markenlogos.',
    '- "keywords" sind zwei bis drei einfache englische Suchbegriffe fuer eine Stockvideo-Datenbank,',
    '  zum Beispiel ["night sky", "stars"]. Keine Adjektive wie "cinematic", keine Satzzeichen.',
    '- Die Summe aller durationSec ergibt ungefaehr die Gesamtlaenge.',
    '- Kein Fliesstext ausserhalb des JSON.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function generateWithOllama(
  request: ScriptRequest,
  options: { url: string; model: string; signal: AbortSignal },
): Promise<ScriptDraft> {
  const response = await fetch(`${options.url.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      stream: false,
      format: 'json',
      options: { temperature: 0.8 },
      messages: [
        { role: 'system', content: 'Du bist ein praeziser Skriptautor und antwortest nur mit gueltigem JSON.' },
        { role: 'user', content: buildPrompt(request) },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama antwortete mit ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as { message?: { content?: string } };
  const content = payload.message?.content;
  if (!content) throw new Error('Ollama lieferte keine Antwort');

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error('Ollama lieferte kein gueltiges JSON');
  }

  const parsed = ollamaResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`Ollama-Antwort hat ein unerwartetes Format: ${parsed.error.issues[0]?.message ?? ''}`);
  }

  const perScene = Math.max(2, Math.round(request.durationSec / parsed.data.scenes.length));
  const scenes: Scene[] = parsed.data.scenes.map((scene, index) => ({
    index,
    prompt: [scene.prompt, request.style, request.guidance].filter(Boolean).join(', '),
    narration: scene.narration,
    durationSec: Math.max(2, Math.min(15, Math.round(scene.durationSec ?? perScene))),
    keywords:
      scene.keywords && scene.keywords.length > 0
        ? scene.keywords.map((word) => word.trim()).filter(Boolean).slice(0, 4)
        : extractKeywords(scene.prompt),
  }));

  const body = scenes.map((scene) => scene.narration).filter(Boolean).join('\n');

  return {
    title: parsed.data.title?.trim() || request.title,
    hook: parsed.data.hook,
    body,
    scenes,
    wordCount: countWords(body),
    estimatedDurationSec: scenes.reduce((sum, scene) => sum + scene.durationSec, 0),
    provider: `ollama:${options.model}`,
    language: request.language,
  };
}
