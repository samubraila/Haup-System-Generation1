import { useQuery } from '@tanstack/react-query';
import { BarChart3, Eye, Heart, MessageCircle, Share2, TrendingUp, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ErrorNote, MetricCard, PageHeader, PlatformChip } from '@/components/common';
import { Card, CardHeader, EmptyState, Select, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatNumber, PLATFORM_META } from '@/lib/format';
import type { AnalyticsSummary, Platform } from '@/lib/types';

interface TopPost {
  postId: string;
  videoId: string;
  title: string;
  platform: Platform;
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
  publishedAt: string | null;
  externalUrl: string | null;
}

const AXIS_STYLE = { fill: '#6b7290', fontSize: 11 };

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: unknown[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-edge bg-surface-raised px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {(payload as Array<{ name: string; value: number; color: string }>).map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-ink-muted">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-medium text-ink">{formatNumber(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState('30');

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api.get<AnalyticsSummary>(`/api/analytics/summary?days=${days}`),
  });

  const { data: top } = useQuery({
    queryKey: ['analytics-top'],
    queryFn: () => api.get<{ items: TopPost[] }>('/api/analytics/top?limit=10'),
  });

  const hasData = (data?.totals.views ?? 0) > 0 || (data?.byPlatform.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Kennzahlen werden regelmaessig ueber die offiziellen APIs der Plattformen abgerufen"
        actions={
          <Select value={days} onChange={(event) => setDays(event.target.value)} className="w-auto">
            <option value="7">Letzte 7 Tage</option>
            <option value="30">Letzte 30 Tage</option>
            <option value="90">Letzte 90 Tage</option>
            <option value="365">Letztes Jahr</option>
          </Select>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-8 w-24" />
            </Card>
          ))}
        </div>
      ) : error || !data ? (
        <ErrorNote
          message={error instanceof ApiError ? error.message : 'Die Kennzahlen konnten nicht geladen werden'}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Views" value={data!.totals.views} icon={<Eye className="h-5 w-5" />} />
            <MetricCard label="Likes" value={data!.totals.likes} icon={<Heart className="h-5 w-5" />} />
            <MetricCard label="Kommentare" value={data!.totals.comments} icon={<MessageCircle className="h-5 w-5" />} />
            <MetricCard label="Shares" value={data!.totals.shares} icon={<Share2 className="h-5 w-5" />} />
            <MetricCard label="Follower" value={data!.totals.followersGained} icon={<UserPlus className="h-5 w-5" />} />
            <MetricCard
              label="Engagement"
              value={`${data!.totals.engagementRate.toFixed(2).replace('.', ',')} %`}
              icon={<TrendingUp className="h-5 w-5" />}
              tone="brand"
            />
          </div>

          {!hasData ? (
            <Card className="mt-6">
              <EmptyState
                icon={<BarChart3 className="h-6 w-6" />}
                title="Noch keine Kennzahlen"
                description="Sobald ein Video veroeffentlicht ist, holt der jeweilige Publisher-Worker regelmaessig die Statistik von der Plattform."
              />
            </Card>
          ) : (
            <>
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader title="Verlauf" subtitle="Views, Likes und Kommentare je Tag" />
                  <div className="h-72 p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data!.timeline}>
                        <defs>
                          <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="likesFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#a855f7" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#222738" vertical={false} />
                        <XAxis dataKey="day" tick={AXIS_STYLE} axisLine={false} tickLine={false} minTickGap={24} />
                        <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={48} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 12, color: '#9aa0b8' }} />
                        <Area
                          type="monotone"
                          dataKey="views"
                          name="Views"
                          stroke="#6366f1"
                          strokeWidth={2}
                          fill="url(#viewsFill)"
                        />
                        <Area
                          type="monotone"
                          dataKey="likes"
                          name="Likes"
                          stroke="#a855f7"
                          strokeWidth={2}
                          fill="url(#likesFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Nach Plattform" subtitle="Gesamtviews" />
                  <div className="h-52 p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data!.byPlatform} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#222738" horizontal={false} />
                        <XAxis type="number" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                        <YAxis
                          type="category"
                          dataKey="platform"
                          tick={AXIS_STYLE}
                          axisLine={false}
                          tickLine={false}
                          width={72}
                        />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#141726' }} />
                        <Bar dataKey="views" name="Views" radius={[0, 6, 6, 0]}>
                          {data!.byPlatform.map((entry) => (
                            <Cell key={entry.platform} fill={PLATFORM_META[entry.platform]?.color ?? '#6366f1'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <ul className="divide-y divide-edge border-t border-edge">
                    {data!.byPlatform.map((entry) => (
                      <li key={entry.platform} className="flex items-center justify-between px-5 py-2.5">
                        <PlatformChip platform={entry.platform} size="sm" />
                        <span className="text-sm font-semibold tabular-nums text-ink">{formatNumber(entry.views)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>

              <Card className="mt-4">
                <CardHeader title="Beste Videos" subtitle="Sortiert nach Views" />
                {(top?.items.length ?? 0) === 0 ? (
                  <EmptyState title="Noch keine veroeffentlichten Videos" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-faint">
                          <th className="px-5 py-3 font-medium">Titel</th>
                          <th className="px-5 py-3 font-medium">Plattform</th>
                          <th className="px-5 py-3 text-right font-medium">Views</th>
                          <th className="px-5 py-3 text-right font-medium">Likes</th>
                          <th className="px-5 py-3 text-right font-medium">Kommentare</th>
                          <th className="px-5 py-3 text-right font-medium">Engagement</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-edge">
                        {(top?.items ?? []).map((entry) => (
                          <tr key={entry.postId} className="hover:bg-surface-hover">
                            <td className="max-w-[280px] px-5 py-3">
                              <Link to={`/videos/${entry.videoId}`} className="truncate text-ink hover:text-brand-400">
                                {entry.title}
                              </Link>
                            </td>
                            <td className="px-5 py-3">
                              <PlatformChip platform={entry.platform} size="sm" />
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">{formatNumber(entry.views)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">{formatNumber(entry.likes)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">{formatNumber(entry.comments)}</td>
                            <td className="px-5 py-3 text-right tabular-nums text-brand-400">
                              {entry.engagementRate.toFixed(2).replace('.', ',')} %
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
