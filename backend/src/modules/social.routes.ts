import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { requireAuth, requireEditor } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { audit, contextFromRequest } from '../services/audit.js';
import {
  beginConnect,
  completeConnect,
  disconnect,
  listAccounts,
  platformOverview,
} from '../services/social/accounts.js';
import { SUPPORTED_PLATFORMS } from '../services/social/providers.js';
import { asyncHandler } from '../utils/http.js';

export const socialRouter: Router = Router();

const connectSchema = z.object({
  platform: z.enum(SUPPORTED_PLATFORMS as unknown as [string, ...string[]]),
  redirectTo: z.string().max(200).default('/social'),
});

socialRouter.get(
  '/platforms',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await platformOverview(req.user!.id) });
  }),
);

socialRouter.get(
  '/accounts',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listAccounts(req.user!.id) });
  }),
);

socialRouter.post(
  '/connect',
  requireAuth,
  requireEditor,
  validateBody(connectSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof connectSchema>;
    const { authorizeUrl } = await beginConnect(req.user!.id, body.platform, body.redirectTo);
    await audit('social.connect_started', contextFromRequest(req), 'platform', body.platform);
    res.json({ authorizeUrl });
  }),
);

for (const platform of SUPPORTED_PLATFORMS) {
  socialRouter.get(
    `/${platform}/callback`,
    asyncHandler(async (req, res) => {
      const state = String(req.query.state ?? '');
      const code = String(req.query.code ?? '');
      const oauthError = req.query.error ? String(req.query.error) : null;

      const back = (params: Record<string, string>) =>
        `${config.APP_URL}/social?${new URLSearchParams(params).toString()}`;

      if (oauthError) {
        res.redirect(back({ platform, status: 'error', message: oauthError }));
        return;
      }
      if (!state || !code) {
        res.redirect(back({ platform, status: 'error', message: 'Antwort der Plattform war unvollstaendig' }));
        return;
      }

      try {
        const { account, redirectTo } = await completeConnect(state, code);
        await audit('social.connected', { userId: null, ip: req.ip, userAgent: '' }, 'social_account', account.id, {
          platform,
        });
        res.redirect(
          `${config.APP_URL}${redirectTo.startsWith('/') ? redirectTo : '/social'}?${new URLSearchParams({
            platform,
            status: 'connected',
            account: account.accountName,
          }).toString()}`,
        );
      } catch (err) {
        res.redirect(back({ platform, status: 'error', message: (err as Error).message.slice(0, 200) }));
      }
    }),
  );
}

socialRouter.delete(
  '/accounts/:id',
  requireAuth,
  requireEditor,
  asyncHandler(async (req, res) => {
    await disconnect(req.user!.id, req.params.id!);
    await audit('social.disconnected', contextFromRequest(req), 'social_account', req.params.id!);
    res.status(204).end();
  }),
);
