import { randomBytes } from 'node:crypto';
import { query, queryMany, queryOne } from '../../db/pool.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { writeLog } from '../log-store.js';
import type { SocialAccountRow } from '../types.js';
import { getProvider, requireConfigured, SUPPORTED_PLATFORMS, type Platform } from './providers.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface PublicAccount {
  id: string;
  platform: Platform;
  accountName: string;
  externalId: string;
  avatarUrl: string | null;
  status: SocialAccountRow['status'];
  scopes: string[];
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  lastError: string | null;
  requiresReconnect: boolean;
  meta: Record<string, unknown>;
}

function toPublic(row: SocialAccountRow): PublicAccount {
  const meta = { ...row.meta };
  delete meta.pageAccessToken;
  return {
    id: row.id,
    platform: row.platform,
    accountName: row.account_name,
    externalId: row.external_id,
    avatarUrl: row.avatar_url,
    status: row.status,
    scopes: row.scopes,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
    connectedAt: row.connected_at ? new Date(row.connected_at).toISOString() : null,
    lastError: row.last_error,
    requiresReconnect: row.requires_reconnect,
    meta,
  };
}

export interface PlatformStatus {
  platform: Platform;
  label: string;
  configured: boolean;
  missingEnv: string[];
  docsUrl: string;
  scopes: string[];
  accounts: PublicAccount[];
}

export async function platformOverview(userId: string): Promise<PlatformStatus[]> {
  const rows = await queryMany<SocialAccountRow>(
    'SELECT * FROM social_accounts WHERE user_id = $1 ORDER BY platform, created_at',
    [userId],
  );

  return SUPPORTED_PLATFORMS.map((platform) => {
    const provider = getProvider(platform);
    return {
      platform,
      label: provider.label,
      configured: provider.isConfigured(),
      missingEnv: provider.missingEnv(),
      docsUrl: provider.docsUrl,
      scopes: provider.scopes,
      accounts: rows.filter((row) => row.platform === platform).map(toPublic),
    };
  });
}

export async function listAccounts(userId: string): Promise<PublicAccount[]> {
  const rows = await queryMany<SocialAccountRow>(
    'SELECT * FROM social_accounts WHERE user_id = $1 ORDER BY platform, account_name',
    [userId],
  );
  return rows.map(toPublic);
}

export async function beginConnect(
  userId: string,
  platform: string,
  redirectTo: string,
): Promise<{ authorizeUrl: string; state: string }> {
  const provider = requireConfigured(platform);
  const state = randomBytes(32).toString('base64url');

  await query('DELETE FROM oauth_states WHERE expires_at < now()');
  await query(
    `INSERT INTO oauth_states (state, platform, user_id, redirect_to, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)`,
    [state, provider.platform, userId, redirectTo.slice(0, 200), String(STATE_TTL_MS)],
  );

  return { authorizeUrl: provider.authorizeUrl(state), state };
}

export async function completeConnect(
  state: string,
  code: string,
): Promise<{ account: PublicAccount; redirectTo: string }> {
  const stateRow = await queryOne<{ platform: string; user_id: string; redirect_to: string; expires_at: Date }>(
    'SELECT platform, user_id, redirect_to, expires_at FROM oauth_states WHERE state = $1',
    [state],
  );
  if (!stateRow) throw new BadRequestError('Der Autorisierungsvorgang ist unbekannt oder abgelaufen');
  await query('DELETE FROM oauth_states WHERE state = $1', [state]);
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    throw new BadRequestError('Der Autorisierungsvorgang ist abgelaufen. Bitte erneut starten.');
  }

  const provider = requireConfigured(stateRow.platform);
  const tokens = await provider.exchangeCode(code);
  const profile = await provider.fetchProfile(tokens.accessToken);

  const accessEnc = encryptSecret(tokens.accessToken);
  const refreshEnc = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null;
  const meta = { ...profile.meta };
  if (typeof meta.pageAccessToken === 'string' && meta.pageAccessToken) {
    meta.pageAccessToken = encryptSecret(meta.pageAccessToken);
    meta.pageAccessTokenEncrypted = true;
  }

  const existing = await queryOne<SocialAccountRow>(
    'SELECT * FROM social_accounts WHERE platform = $1 AND external_id = $2',
    [provider.platform, profile.externalId],
  );

  const row = existing
    ? await queryOne<SocialAccountRow>(
        `UPDATE social_accounts
         SET user_id = $2, account_name = $3, avatar_url = $4, status = 'connected', scopes = $5,
             access_token_enc = $6, refresh_token_enc = COALESCE($7, refresh_token_enc),
             token_expires_at = $8, connected_at = now(), last_checked_at = now(),
             last_error = NULL, requires_reconnect = FALSE, meta = $9
         WHERE id = $1
         RETURNING *`,
        [
          existing.id,
          stateRow.user_id,
          profile.accountName,
          profile.avatarUrl,
          tokens.scopes,
          accessEnc,
          refreshEnc,
          tokens.expiresAt,
          JSON.stringify(meta),
        ],
      )
    : await queryOne<SocialAccountRow>(
        `INSERT INTO social_accounts
           (user_id, platform, account_name, external_id, avatar_url, status, scopes,
            access_token_enc, refresh_token_enc, token_expires_at, connected_at, last_checked_at, meta)
         VALUES ($1, $2, $3, $4, $5, 'connected', $6, $7, $8, $9, now(), now(), $10)
         RETURNING *`,
        [
          stateRow.user_id,
          provider.platform,
          profile.accountName,
          profile.externalId,
          profile.avatarUrl,
          tokens.scopes,
          accessEnc,
          refreshEnc,
          tokens.expiresAt,
          JSON.stringify(meta),
        ],
      );

  if (!row) throw new Error('Konto konnte nicht gespeichert werden');

  await writeLog('info', 'social', `${provider.label} verbunden: ${profile.accountName}`, {
    platform: provider.platform,
    accountId: row.id,
  });

  return { account: toPublic(row), redirectTo: stateRow.redirect_to };
}

export async function disconnect(userId: string, accountId: string): Promise<void> {
  const row = await queryOne<SocialAccountRow>('SELECT * FROM social_accounts WHERE id = $1 AND user_id = $2', [
    accountId,
    userId,
  ]);
  if (!row) throw new NotFoundError('Konto');

  await query(
    `UPDATE social_accounts
     SET status = 'disconnected', access_token_enc = NULL, refresh_token_enc = NULL,
         token_expires_at = NULL, requires_reconnect = TRUE, meta = '{}'::jsonb
     WHERE id = $1`,
    [accountId],
  );
  await writeLog('info', 'social', `${row.platform} getrennt: ${row.account_name}`, { accountId });
}

export interface ResolvedCredentials {
  accountId: string;
  platform: Platform;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  externalId: string;
  meta: Record<string, unknown>;
}

export async function resolveCredentials(accountId: string): Promise<ResolvedCredentials> {
  let row = await queryOne<SocialAccountRow>('SELECT * FROM social_accounts WHERE id = $1', [accountId]);
  if (!row) throw new NotFoundError('Konto');
  if (!row.access_token_enc) {
    throw new ConflictError(`Konto ${row.account_name} ist nicht verbunden`);
  }

  const platform = row.platform;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  const needsRefresh = expiresAt !== null && expiresAt - Date.now() < REFRESH_MARGIN_MS;

  if (needsRefresh && row.refresh_token_enc) {
    const provider = requireConfigured(row.platform);
    try {
      const refreshed = await provider.refresh(decryptSecret(row.refresh_token_enc));
      row = await queryOne<SocialAccountRow>(
        `UPDATE social_accounts
         SET access_token_enc = $2, refresh_token_enc = COALESCE($3, refresh_token_enc),
             token_expires_at = $4, status = 'connected', last_error = NULL,
             requires_reconnect = FALSE, last_checked_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          accountId,
          encryptSecret(refreshed.accessToken),
          refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : null,
          refreshed.expiresAt,
        ],
      );
      await writeLog('info', 'social', `Zugriffstoken erneuert: ${provider.label}`, { accountId });
    } catch (err) {
      await markAccountError(accountId, (err as Error).message, true);
      throw new ConflictError(
        `Das Zugriffstoken fuer ${platform} konnte nicht erneuert werden. Bitte das Konto neu verbinden.`,
      );
    }
  } else if (needsRefresh && !row.refresh_token_enc) {
    await markAccountError(accountId, 'Zugriffstoken abgelaufen und kein Refresh-Token vorhanden', true);
    throw new ConflictError(`Das Zugriffstoken fuer ${platform} ist abgelaufen. Bitte neu verbinden.`);
  }

  if (!row?.access_token_enc) throw new ConflictError('Konto ist nicht verbunden');

  const current = row;
  const meta = { ...current.meta };
  if (meta.pageAccessTokenEncrypted && typeof meta.pageAccessToken === 'string') {
    meta.pageAccessToken = decryptSecret(meta.pageAccessToken);
    delete meta.pageAccessTokenEncrypted;
  }

  return {
    accountId: current.id,
    platform: current.platform,
    accessToken: decryptSecret(current.access_token_enc!),
    refreshToken: current.refresh_token_enc ? decryptSecret(current.refresh_token_enc) : null,
    expiresAt: current.token_expires_at ? new Date(current.token_expires_at).toISOString() : null,
    externalId: current.external_id,
    meta,
  };
}

export async function storeRefreshedTokens(
  accountId: string,
  tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: string | null },
): Promise<void> {
  await query(
    `UPDATE social_accounts
     SET access_token_enc = $2, refresh_token_enc = COALESCE($3, refresh_token_enc),
         token_expires_at = $4, status = 'connected', last_error = NULL,
         requires_reconnect = FALSE, last_checked_at = now()
     WHERE id = $1`,
    [
      accountId,
      encryptSecret(tokens.accessToken),
      tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    ],
  );
}

export async function markAccountError(
  accountId: string,
  error: string,
  requiresReconnect: boolean,
): Promise<void> {
  await query(
    `UPDATE social_accounts
     SET status = $3, last_error = $2, requires_reconnect = $4, last_checked_at = now()
     WHERE id = $1`,
    [accountId, error.slice(0, 1000), requiresReconnect ? 'expired' : 'error', requiresReconnect],
  );
  await writeLog('warn', 'social', `Problem mit Social-Konto: ${error}`, { accountId, requiresReconnect });
}

export async function accountForPlatform(userId: string, platform: string): Promise<SocialAccountRow | null> {
  return queryOne<SocialAccountRow>(
    `SELECT * FROM social_accounts
     WHERE user_id = $1 AND platform = $2 AND status = 'connected'
     ORDER BY connected_at DESC NULLS LAST
     LIMIT 1`,
    [userId, platform],
  );
}
