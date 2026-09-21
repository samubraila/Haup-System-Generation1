import { PermanentJobError, QUEUES, runWorker, scriptJobSchema } from '@acf/worker-core';
import { buildTemplateScript, generateWithOllama, type ScriptRequest } from './generators.js';

interface ScriptPayload extends Record<string, unknown> {
  provider?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  sceneCount?: number;
}

await runWorker<ScriptPayload>({
  name: 'script-worker',
  queue: QUEUES.SCRIPT,
  defaultConcurrency: 2,

  async onStart({ logger }) {
    logger.info('Script-Worker bereit');
    return { providers: ['template', 'ollama'] };
  },

  async handler(ctx) {
    const parsed = scriptJobSchema.safeParse(ctx.data);
    if (!parsed.success) {
      throw new PermanentJobError(
        `Ungueltige Auftragsdaten: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`,
      );
    }

    const job = parsed.data;
    const provider = ctx.data.provider === 'ollama' ? 'ollama' : 'template';
    const sceneCount = Number(ctx.data.sceneCount ?? 4);

    const request: ScriptRequest = {
      title: job.title,
      topic: job.topic,
      description: job.description,
      language: job.language,
      style: job.style,
      durationSec: job.durationSec,
      format: job.format,
      guidance: job.guidance,
      sceneCount,
    };

    await ctx.reportProgress(10, 'Skript wird erstellt');

    let draft = buildTemplateScript(request);

    if (provider === 'ollama') {
      const url = String(ctx.data.ollamaUrl ?? 'http://host.docker.internal:11434');
      const model = String(ctx.data.ollamaModel ?? 'llama3.1:8b');
      try {
        await ctx.reportProgress(25, `Lokales Sprachmodell wird angefragt (${model})`);
        draft = await generateWithOllama(request, { url, model, signal: ctx.signal });
        ctx.logger.info({ model, scenes: draft.scenes.length }, 'Skript von Ollama erzeugt');
      } catch (err) {
        ctx.logger.warn(
          { err: (err as Error).message, url, model },
          'Ollama nicht verfuegbar, es wird ein Geruest aus der Vorlage verwendet',
        );
        await ctx.api.log(
          'warn',
          `Ollama war nicht erreichbar (${(err as Error).message}). Es wurde ein Skript-Geruest erzeugt, das manuell ergaenzt werden muss.`,
          { videoId: job.videoId, url, model },
        );
      }
    }

    await ctx.reportProgress(70, 'Skript wird gespeichert');

    const relativePath = ctx.storage.projectPath(job.projectId, 'scripts', `${job.videoId}.md`);
    const markdown = [
      `# ${draft.title}`,
      '',
      draft.hook ? `> ${draft.hook}` : '',
      '',
      ...draft.scenes.map(
        (scene) =>
          `## Szene ${scene.index + 1} (${scene.durationSec}s)\n\n**Bild:** ${scene.prompt}\n\n**Text:** ${scene.narration}`,
      ),
    ]
      .filter((line) => line !== undefined)
      .join('\n\n');

    await ctx.storage.writeText(relativePath, markdown, 'text/markdown; charset=utf-8');

    await ctx.api.registerMedia({
      projectId: job.projectId,
      videoId: job.videoId,
      kind: 'script',
      path: relativePath,
      fileName: `${job.videoId}.md`,
      mimeType: 'text/markdown',
      sizeBytes: Buffer.byteLength(markdown, 'utf8'),
      meta: { stage: 'script', provider: draft.provider },
    });

    await ctx.reportProgress(100, 'Skript fertig');

    return {
      title: draft.title,
      hook: draft.hook,
      body: draft.body,
      scenes: draft.scenes,
      wordCount: draft.wordCount,
      estimatedDurationSec: draft.estimatedDurationSec,
      provider: draft.provider,
      language: draft.language,
      scriptPath: relativePath,
    };
  },
});
