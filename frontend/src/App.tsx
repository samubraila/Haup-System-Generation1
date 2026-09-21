import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { AnalyticsPage } from '@/pages/Analytics';
import { AutomationsPage } from '@/pages/Automations';
import { CalendarPage } from '@/pages/Calendar';
import { DashboardPage } from '@/pages/Dashboard';
import { IdeasPage } from '@/pages/Ideas';
import { LibraryPage } from '@/pages/Library';
import { LoginPage } from '@/pages/Login';
import { ProjectsPage } from '@/pages/Projects';
import { PublishingPage } from '@/pages/Publishing';
import { QueuePage } from '@/pages/Queue';
import { SocialPage } from '@/pages/Social';
import {
  StudioImagePage,
  StudioScriptPage,
  StudioSubtitlePage,
  StudioVideoPage,
  StudioVoicePage,
} from '@/pages/Studio';
import { GpuPage, LogsPage, ServicesPage, SettingsPage, StoragePage } from '@/pages/System';
import { VideoDetailPage } from '@/pages/VideoDetail';
import { DraftsPage, VideosPage } from '@/pages/Videos';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="ideas" element={<IdeasPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="videos" element={<VideosPage />} />
        <Route path="videos/:id" element={<VideoDetailPage />} />
        <Route path="drafts" element={<DraftsPage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="library" element={<LibraryPage />} />

        <Route path="studio/script" element={<StudioScriptPage />} />
        <Route path="studio/images" element={<StudioImagePage />} />
        <Route path="studio/video" element={<StudioVideoPage />} />
        <Route path="studio/voice" element={<StudioVoicePage />} />
        <Route path="studio/subtitles" element={<StudioSubtitlePage />} />

        <Route path="social" element={<SocialPage />} />
        <Route path="publishing" element={<PublishingPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="automations" element={<AutomationsPage />} />

        <Route path="system/services" element={<ServicesPage />} />
        <Route path="system/gpu" element={<GpuPage />} />
        <Route path="system/storage" element={<StoragePage />} />
        <Route path="system/logs" element={<LogsPage />} />
        <Route path="system/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
