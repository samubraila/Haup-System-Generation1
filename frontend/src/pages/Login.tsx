import { motion } from 'framer-motion';
import { Film, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, Field, Input, Spinner } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
            <Film className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Content Studio</h1>
            <p className="mt-1 text-sm text-ink-muted">Lokale Content Factory fuer Video und Social Media</p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <Field label="E-Mail">
              <Input
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@localhost"
              />
            </Field>

            <Field label="Passwort">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="********"
              />
            </Field>

            {error ? (
              <p className="rounded-lg border border-state-danger/30 bg-state-danger/10 px-3 py-2 text-sm text-state-danger">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full justify-center"
              loading={submitting}
              icon={<LogIn className="h-4 w-4" />}
            >
              Anmelden
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-ink-faint">
          Die Zugangsdaten stammen aus ADMIN_EMAIL und ADMIN_PASSWORD in deiner .env-Datei.
        </p>
      </motion.div>
    </div>
  );
}
