import { FormEvent, useEffect, useState } from 'react';
import App from './App';

type User = { id: string; email: string; role: 'USER' | 'ADMIN' };

export default function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(async response => response.ok ? (await response.json()).data as User : null)
      .then(setUser).catch(() => setUser(null)).finally(() => setReady(true));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const send = async (path: string) => {
        const response = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Authentication failed.');
        return body.data as User;
      };
      if (register) await send('register');
      setUser(await send('login'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  if (!ready) return <main className="min-h-screen bg-neutral-950 text-neutral-300 grid place-items-center">Loading AgentArena…</main>;
  if (user) return <App user={user} onLogout={async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { setUser(null); } }} />;
  return <main className="min-h-screen bg-neutral-950 text-neutral-100 grid place-items-center p-4">
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7 space-y-5">
      <div><h1 className="text-2xl font-bold">AgentArena</h1><p className="text-sm text-neutral-400 mt-1">{register ? 'Create your account' : 'Sign in to continue'}</p></div>
      <label className="block text-sm text-neutral-300">Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
      <label className="block text-sm text-neutral-300">Password<input required type="password" minLength={12} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /><span className="text-xs text-neutral-500">At least 12 characters.</span></label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
      <button type="button" onClick={() => { setRegister(!register); setError(''); }} className="w-full text-sm text-cyan-300">{register ? 'Already registered? Sign in' : 'Need an account? Register'}</button>
    </form>
  </main>;
}
