import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  BarChart3,
  Bot,
  CalendarDays,
  ClipboardList,
  Cpu,
  FileText,
  FileVideo,
  Film,
  FolderKanban,
  HardDrive,
  Image,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Mic,
  ScrollText,
  Settings,
  Share2,
  Sparkles,
  Subtitles,
  Workflow,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/format';
import type { ReactNode } from 'react';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

interface NavGroup {
  title: string | null;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: null,
    items: [{ to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, end: true }],
  },
  {
    title: 'Content',
    items: [
      { to: '/ideas', label: 'Ideen', icon: <Lightbulb className="h-4 w-4" /> },
      { to: '/projects', label: 'Projekte', icon: <FolderKanban className="h-4 w-4" /> },
      { to: '/videos', label: 'Videos', icon: <Film className="h-4 w-4" /> },
      { to: '/drafts', label: 'Entwuerfe', icon: <FileVideo className="h-4 w-4" /> },
      { to: '/queue', label: 'Warteschlange', icon: <ListChecks className="h-4 w-4" /> },
      { to: '/calendar', label: 'Kalender', icon: <CalendarDays className="h-4 w-4" /> },
      { to: '/library', label: 'Bibliothek', icon: <ClipboardList className="h-4 w-4" /> },
    ],
  },
  {
    title: 'AI Studio',
    items: [
      { to: '/studio/script', label: 'Script', icon: <FileText className="h-4 w-4" /> },
      { to: '/studio/images', label: 'Bilder', icon: <Image className="h-4 w-4" /> },
      { to: '/studio/video', label: 'Video', icon: <Sparkles className="h-4 w-4" /> },
      { to: '/studio/voice', label: 'Voice', icon: <Mic className="h-4 w-4" /> },
      { to: '/studio/subtitles', label: 'Untertitel', icon: <Subtitles className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Social Media',
    items: [
      { to: '/social', label: 'Konten', icon: <Share2 className="h-4 w-4" /> },
      { to: '/publishing', label: 'Publishing', icon: <Bot className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Auswertung',
    items: [
      { to: '/analytics', label: 'Analytics', icon: <BarChart3 className="h-4 w-4" /> },
      { to: '/automations', label: 'Automatisierungen', icon: <Workflow className="h-4 w-4" /> },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/system/services', label: 'Dienste', icon: <Activity className="h-4 w-4" /> },
      { to: '/system/gpu', label: 'GPU', icon: <Cpu className="h-4 w-4" /> },
      { to: '/system/storage', label: 'Speicher', icon: <HardDrive className="h-4 w-4" /> },
      { to: '/system/logs', label: 'Logs', icon: <ScrollText className="h-4 w-4" /> },
      { to: '/system/settings', label: 'Einstellungen', icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 pb-6">
      {GROUPS.map((group, index) => (
        <div key={group.title ?? `group-${index}`} className="space-y-1">
          {group.title ? (
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {group.title}
            </p>
          ) : null}
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                  isActive ? 'text-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-xl border border-brand-500/30 bg-brand-500/10"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <span className={cn('relative', isActive && 'text-brand-400')}>{item.icon}</span>
                  <span className="relative font-medium">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
        <Film className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight text-ink">AI Content Studio</p>
        <p className="truncate text-[11px] text-ink-faint">Lokale Content Factory</p>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-edge bg-surface/60 backdrop-blur lg:flex">
      <Brand />
      <NavItems />
    </aside>
  );
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="relative flex h-full w-72 flex-col border-r border-edge bg-surface"
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button
                onClick={onClose}
                className="mr-4 rounded-lg p-2 text-ink-muted hover:bg-surface-hover"
                aria-label="Menue schliessen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavItems onNavigate={onClose} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
