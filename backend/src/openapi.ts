export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'AI Content Factory API',
    version: '1.0.0',
    description:
      'REST-API des Hauptsystems. Die Oberflaeche nutzt ausschliesslich diese API. ' +
      'Worker-Container und n8n verwenden die separaten Bereiche /api/internal und /api/automation mit dem Header X-API-Key.',
  },
  servers: [{ url: '/', description: 'Aktuelle Instanz' }],
  tags: [
    { name: 'Auth', description: 'Anmeldung, Sitzung, Benutzerverwaltung' },
    { name: 'Projects', description: 'Content-Projekte mit eigenen Voreinstellungen' },
    { name: 'Ideas', description: 'Ideenspeicher' },
    { name: 'Videos', description: 'Videos, Pipeline, Freigabe und Veroeffentlichungsziele' },
    { name: 'Jobs', description: 'Warteschlange und Job-Steuerung' },
    { name: 'Media', description: 'Medienbibliothek und Dateiauslieferung' },
    { name: 'Social', description: 'Social-Media-Konten und OAuth' },
    { name: 'Calendar', description: 'Content-Kalender' },
    { name: 'Analytics', description: 'Kennzahlen veroeffentlichter Videos' },
    { name: 'System', description: 'Zustand der Container, Logs, Einstellungen, Backups' },
    { name: 'Internal', description: 'Nur fuer Worker-Container (X-API-Key)' },
    { name: 'Automation', description: 'Nur fuer n8n (X-API-Key)' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'acf_at' },
      internalKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'not_found' },
              message: { type: 'string' },
              details: {},
            },
          },
        },
      },
      Video: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'DRAFT',
              'QUEUED',
              'WAITING_FOR_GPU',
              'GENERATING',
              'PROCESSING',
              'GENERATED',
              'REVIEW_REQUIRED',
              'APPROVED',
              'SCHEDULED',
              'PUBLISHING',
              'PUBLISHED',
              'FAILED',
              'ARCHIVED',
            ],
          },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          format: { type: 'string' },
          aspectRatio: { type: 'string', enum: ['9:16', '16:9', '1:1', '4:5'] },
          durationSec: { type: 'integer' },
          requireApproval: { type: 'boolean' },
          error: { type: 'string', nullable: true },
        },
      },
      Job: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['script', 'image', 'video', 'voice', 'subtitle', 'ffmpeg'] },
          queue: { type: 'string' },
          status: {
            type: 'string',
            enum: ['PENDING', 'WAITING_FOR_GPU', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
          },
          progress: { type: 'integer' },
          attempts: { type: 'integer' },
          error: { type: 'string', nullable: true },
        },
      },
    },
  },
  security: [{ cookieAuth: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Anmelden',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Angemeldet, Cookies gesetzt' },
          401: { description: 'Zugangsdaten falsch', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'Angemeldeten Benutzer und CSRF-Token abrufen', responses: { 200: { description: 'OK' } } },
    },
    '/api/auth/logout': {
      post: { tags: ['Auth'], summary: 'Abmelden', responses: { 204: { description: 'Abgemeldet' } } },
    },
    '/api/dashboard': {
      get: { tags: ['System'], summary: 'Kennzahlen und Live-Zustand fuer das Dashboard', responses: { 200: { description: 'OK' } } },
    },
    '/api/projects': {
      get: { tags: ['Projects'], summary: 'Projekte auflisten', responses: { 200: { description: 'OK' } } },
      post: { tags: ['Projects'], summary: 'Projekt anlegen', responses: { 201: { description: 'Angelegt' } } },
    },
    '/api/projects/{id}': {
      get: { tags: ['Projects'], summary: 'Projekt mit Statistik', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } },
      patch: { tags: ['Projects'], summary: 'Projekt aendern', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Projects'], summary: 'Projekt loeschen', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Geloescht' } } },
    },
    '/api/videos': {
      get: {
        tags: ['Videos'],
        summary: 'Videos filtern',
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Komma-getrennte Statuswerte' },
          { name: 'platform', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'OK' } },
      },
      post: {
        tags: ['Videos'],
        summary: 'Video anlegen und optional sofort generieren',
        responses: { 201: { description: 'Angelegt', content: { 'application/json': { schema: { $ref: '#/components/schemas/Video' } } } } },
      },
    },
    '/api/videos/{id}': {
      get: { tags: ['Videos'], summary: 'Video mit Pipeline, Jobs, Medien und Veroeffentlichungen', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Videos'], summary: 'Video loeschen', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Geloescht' } } },
    },
    '/api/videos/{id}/generate': {
      post: { tags: ['Videos'], summary: 'Generierung starten', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Eingereiht' }, 409: { description: 'Laeuft bereits' } } },
    },
    '/api/videos/{id}/approve': {
      post: { tags: ['Videos'], summary: 'Video freigeben und geplante Veroeffentlichungen starten', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Freigegeben' }, 409: { description: 'Noch nicht fertig gerendert' } } },
    },
    '/api/videos/{id}/publish': {
      put: { tags: ['Videos'], summary: 'Veroeffentlichungsziele setzen (now, schedule, draft)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Gespeichert' } } },
    },
    '/api/jobs': {
      get: { tags: ['Jobs'], summary: 'Jobs der Warteschlange', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Job' } } } } } } } } },
    },
    '/api/jobs/queues': {
      get: { tags: ['Jobs'], summary: 'Fuellstand aller Queues', responses: { 200: { description: 'OK' } } },
    },
    '/api/jobs/{id}/retry': {
      post: { tags: ['Jobs'], summary: 'Job erneut versuchen', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Eingereiht' } } },
    },
    '/api/media': {
      get: { tags: ['Media'], summary: 'Medienbibliothek durchsuchen', responses: { 200: { description: 'OK' } } },
    },
    '/api/media/{id}/file': {
      get: { tags: ['Media'], summary: 'Datei ausliefern (unterstuetzt Range-Requests)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Datei' }, 206: { description: 'Teilbereich' } } },
    },
    '/api/social/platforms': {
      get: { tags: ['Social'], summary: 'Plattformen mit Einrichtungsstatus und verbundenen Konten', responses: { 200: { description: 'OK' } } },
    },
    '/api/social/connect': {
      post: { tags: ['Social'], summary: 'OAuth-Autorisierung starten', responses: { 200: { description: 'Weiterleitungs-URL' }, 503: { description: 'Plattform nicht eingerichtet' } } },
    },
    '/api/calendar': {
      get: { tags: ['Calendar'], summary: 'Geplante und veroeffentlichte Beitraege im Zeitraum', responses: { 200: { description: 'OK' } } },
    },
    '/api/calendar/{postId}': {
      patch: { tags: ['Calendar'], summary: 'Beitrag verschieben (Drag and Drop)', parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Verschoben' } } },
    },
    '/api/analytics/summary': {
      get: { tags: ['Analytics'], summary: 'Gesamtkennzahlen und Zeitreihe', responses: { 200: { description: 'OK' } } },
    },
    '/api/system/services': {
      get: { tags: ['System'], summary: 'Zustand jedes Containers im Verbund', responses: { 200: { description: 'OK' } } },
    },
    '/api/system/gpu': {
      get: { tags: ['System'], summary: 'GPU-Verfuegbarkeit der Video-Worker', responses: { 200: { description: 'OK' } } },
    },
    '/api/system/events': {
      get: { tags: ['System'], summary: 'Server-Sent-Events fuer Live-Aktualisierungen', responses: { 200: { description: 'Ereignisstrom' } } },
    },
    '/api/internal/jobs/{id}/completed': {
      post: {
        tags: ['Internal'],
        summary: 'Worker meldet Abschluss eines Jobs',
        security: [{ internalKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Uebernommen' } },
      },
    },
    '/api/automation/videos': {
      post: {
        tags: ['Automation'],
        summary: 'n8n legt ein Video an und startet optional die Generierung',
        security: [{ internalKey: [] }],
        responses: { 201: { description: 'Angelegt' } },
      },
    },
  },
} as const;
