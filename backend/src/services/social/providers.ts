import { config } from '../../config/index.js';
import { NotConfiguredError, BadRequestError } from '../../utils/errors.js';

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export interface RemoteProfile {
  externalId: string;
  accountName: string;
  avatarUrl: string | null;
  meta: Record<string, unknown>;
}

export interface SocialProvider {
  platform: Platform;
  label: string;
  docsUrl: string;
  requiredEnv: string[];
  scopes: string[];
  isConfigured(): boolean;
  missingEnv(): string[];
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  fetchProfile(accessToken: string): Promise<RemoteProfile>;
}

const GRAPH_VERSION = 'v21.0';

async function formPost(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BadRequestError(`Unerwartete Antwort von ${url}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message =
      (json.error_description as string) ??
      ((json.error as Record<string, unknown>)?.message as string) ??
      (json.error as string) ??
      `HTTP ${response.status}`;
    throw new BadRequestError(`OAuth-Fehler: ${message}`);
  }
  return json;
}

async function getJson(url: string, accessToken?: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  const text = await response.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BadRequestError(`Unerwartete Antwort von ${url}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message = ((json.error as Record<string, unknown>)?.message as string) ?? `HTTP ${response.status}`;
    throw new BadRequestError(`API-Fehler: ${message}`);
  }
  return json;
}

function expiresIn(seconds: unknown): Date | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000);
}

const youtube: SocialProvider = {
  platform: 'youtube',
  label: 'YouTube',
  docsUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
  requiredEnv: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
  scopes: [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ],
  isConfigured: () => Boolean(config.YOUTUBE_CLIENT_ID && config.YOUTUBE_CLIENT_SECRET),
  missingEnv: () =>
    ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'].filter(
      (key) => !config[key as 'YOUTUBE_CLIENT_ID' | 'YOUTUBE_CLIENT_SECRET'],
    ),
  authorizeUrl(state) {
    const params = new URLSearchParams({
      client_id: config.YOUTUBE_CLIENT_ID,
      redirect_uri: config.YOUTUBE_REDIRECT_URI,
      response_type: 'code',
      scope: youtube.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },
  async exchangeCode(code) {
    const json = await formPost('https://oauth2.googleapis.com/token', {
      code,
      client_id: config.YOUTUBE_CLIENT_ID,
      client_secret: config.YOUTUBE_CLIENT_SECRET,
      redirect_uri: config.YOUTUBE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : null,
      expiresAt: expiresIn(json.expires_in),
      scopes: String(json.scope ?? '').split(' ').filter(Boolean),
    };
  },
  async refresh(refreshToken) {
    const json = await formPost('https://oauth2.googleapis.com/token', {
      refresh_token: refreshToken,
      client_id: config.YOUTUBE_CLIENT_ID,
      client_secret: config.YOUTUBE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : refreshToken,
      expiresAt: expiresIn(json.expires_in),
      scopes: String(json.scope ?? '').split(' ').filter(Boolean),
    };
  },
  async fetchProfile(accessToken) {
    const json = await getJson(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      accessToken,
    );
    const items = (json.items as Array<Record<string, unknown>>) ?? [];
    const channel = items[0];
    if (!channel) {
      throw new BadRequestError('Dieses Google-Konto besitzt keinen YouTube-Kanal');
    }
    const snippet = channel.snippet as Record<string, unknown>;
    const thumbnails = (snippet.thumbnails as Record<string, { url?: string }>) ?? {};
    return {
      externalId: String(channel.id),
      accountName: String(snippet.title ?? 'YouTube-Kanal'),
      avatarUrl: thumbnails.default?.url ?? null,
      meta: { statistics: channel.statistics ?? {} },
    };
  },
};

const tiktok: SocialProvider = {
  platform: 'tiktok',
  label: 'TikTok',
  docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
  requiredEnv: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  scopes: ['user.info.basic', 'video.upload', 'video.publish'],
  isConfigured: () => Boolean(config.TIKTOK_CLIENT_KEY && config.TIKTOK_CLIENT_SECRET),
  missingEnv: () =>
    ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'].filter(
      (key) => !config[key as 'TIKTOK_CLIENT_KEY' | 'TIKTOK_CLIENT_SECRET'],
    ),
  authorizeUrl(state) {
    const params = new URLSearchParams({
      client_key: config.TIKTOK_CLIENT_KEY,
      scope: tiktok.scopes.join(','),
      response_type: 'code',
      redirect_uri: config.TIKTOK_REDIRECT_URI,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  },
  async exchangeCode(code) {
    const json = await formPost('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: config.TIKTOK_CLIENT_KEY,
      client_secret: config.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.TIKTOK_REDIRECT_URI,
    });
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : null,
      expiresAt: expiresIn(json.expires_in),
      scopes: String(json.scope ?? '').split(',').filter(Boolean),
    };
  },
  async refresh(refreshToken) {
    const json = await formPost('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: config.TIKTOK_CLIENT_KEY,
      client_secret: config.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : refreshToken,
      expiresAt: expiresIn(json.expires_in),
      scopes: String(json.scope ?? '').split(',').filter(Boolean),
    };
  },
  async fetchProfile(accessToken) {
    const json = await getJson(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name',
      accessToken,
    );
    const data = (json.data as Record<string, unknown>)?.user as Record<string, unknown> | undefined;
    if (!data) throw new BadRequestError('TikTok lieferte kein Benutzerprofil zurueck');
    return {
      externalId: String(data.open_id ?? ''),
      accountName: String(data.display_name ?? 'TikTok-Konto'),
      avatarUrl: data.avatar_url ? String(data.avatar_url) : null,
      meta: { unionId: data.union_id ?? null },
    };
  },
};

function metaProvider(
  platform: 'instagram' | 'facebook',
  label: string,
  scopes: string[],
  appIdKey: 'INSTAGRAM_APP_ID' | 'FACEBOOK_APP_ID',
  secretKey: 'INSTAGRAM_APP_SECRET' | 'FACEBOOK_APP_SECRET',
  redirectKey: 'INSTAGRAM_REDIRECT_URI' | 'FACEBOOK_REDIRECT_URI',
): SocialProvider {
  const appId = () => config[appIdKey];
  const appSecret = () => config[secretKey];
  const redirectUri = () => config[redirectKey];

  return {
    platform,
    label,
    docsUrl:
      platform === 'instagram'
        ? 'https://developers.facebook.com/docs/instagram-api/guides/content-publishing'
        : 'https://developers.facebook.com/docs/video-api/guides/publishing',
    requiredEnv: [appIdKey, secretKey],
    scopes,
    isConfigured: () => Boolean(appId() && appSecret()),
    missingEnv: () => [appIdKey, secretKey].filter((key) => !config[key as typeof appIdKey | typeof secretKey]),
    authorizeUrl(state) {
      const params = new URLSearchParams({
        client_id: appId(),
        redirect_uri: redirectUri(),
        state,
        response_type: 'code',
        scope: scopes.join(','),
      });
      return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
    },
    async exchangeCode(code) {
      const params = new URLSearchParams({
        client_id: appId(),
        client_secret: appSecret(),
        redirect_uri: redirectUri(),
        code,
      });
      const short = await getJson(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params.toString()}`,
      );
      const longParams = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId(),
        client_secret: appSecret(),
        fb_exchange_token: String(short.access_token),
      });
      const long = await getJson(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${longParams.toString()}`,
      );
      return {
        accessToken: String(long.access_token ?? short.access_token),
        refreshToken: null,
        expiresAt: expiresIn(long.expires_in ?? short.expires_in),
        scopes,
      };
    },
    async refresh(refreshToken) {
      const params = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId(),
        client_secret: appSecret(),
        fb_exchange_token: refreshToken,
      });
      const json = await getJson(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params.toString()}`,
      );
      return {
        accessToken: String(json.access_token),
        refreshToken: String(json.access_token),
        expiresAt: expiresIn(json.expires_in),
        scopes,
      };
    },
    async fetchProfile(accessToken) {
      const pages = await getJson(
        `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token,picture,instagram_business_account{id,username,profile_picture_url}`,
        accessToken,
      );
      const data = (pages.data as Array<Record<string, unknown>>) ?? [];
      if (data.length === 0) {
        throw new BadRequestError(
          platform === 'instagram'
            ? 'Es wurde keine Facebook-Seite mit verknuepftem Instagram-Business-Konto gefunden'
            : 'Es wurde keine verwaltete Facebook-Seite gefunden',
        );
      }

      const targets = data.map((page) => {
        const ig = page.instagram_business_account as Record<string, unknown> | undefined;
        const picture = (page.picture as { data?: { url?: string } } | undefined)?.data?.url ?? null;
        return {
          pageId: String(page.id),
          pageName: String(page.name),
          pageAccessToken: String(page.access_token ?? ''),
          instagramId: ig ? String(ig.id) : null,
          instagramUsername: ig ? String(ig.username ?? '') : null,
          avatarUrl: ig ? String(ig.profile_picture_url ?? picture ?? '') : picture,
        };
      });

      const usable = platform === 'instagram' ? targets.filter((t) => t.instagramId) : targets;
      const selected = usable[0];
      if (!selected) {
        throw new BadRequestError(
          'Keine Facebook-Seite mit verknuepftem Instagram-Business-Konto gefunden. ' +
            'Bitte das Instagram-Konto in den Seiteneinstellungen verknuepfen.',
        );
      }

      return {
        externalId: platform === 'instagram' ? String(selected.instagramId) : selected.pageId,
        accountName:
          platform === 'instagram' ? (selected.instagramUsername || selected.pageName) : selected.pageName,
        avatarUrl: selected.avatarUrl,
        meta: {
          targets: usable.map(({ pageAccessToken: _token, ...rest }) => rest),
          selectedPageId: selected.pageId,
          pageAccessToken: selected.pageAccessToken,
        },
      };
    },
  };
}

const instagram = metaProvider(
  'instagram',
  'Instagram',
  ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'business_management'],
  'INSTAGRAM_APP_ID',
  'INSTAGRAM_APP_SECRET',
  'INSTAGRAM_REDIRECT_URI',
);

const facebook = metaProvider(
  'facebook',
  'Facebook',
  ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'publish_video', 'business_management'],
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'FACEBOOK_REDIRECT_URI',
);

export const providers: Record<Platform, SocialProvider> = { youtube, tiktok, instagram, facebook };

export const SUPPORTED_PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];

export function getProvider(platform: string): SocialProvider {
  const provider = providers[platform as Platform];
  if (!provider) throw new BadRequestError(`Unbekannte Plattform: ${platform}`);
  return provider;
}

export function requireConfigured(platform: string): SocialProvider {
  const provider = getProvider(platform);
  if (!provider.isConfigured()) {
    throw new NotConfiguredError(
      `${provider.label} ist nicht eingerichtet. Fehlende Werte in der .env: ${provider.missingEnv().join(', ')}`,
      { platform: provider.platform, missingEnv: provider.missingEnv(), docsUrl: provider.docsUrl },
    );
  }
  return provider;
}
