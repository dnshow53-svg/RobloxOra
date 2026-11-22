import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Lock, Shield, UserPlus, X } from 'lucide-react';
import { ADMIN_EMAIL, ADMIN_PASSWORD, RegisteredUser } from '../data/packages';

export type AuthModalMode = 'signin' | 'signup' | 'admin';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: AuthModalMode;
  noticeMessage?: string | null;
  users: RegisteredUser[];
  onClose: () => void;
  onUserSignIn: (user: RegisteredUser) => void;
  onUserSignUp: (newUser: RegisteredUser) => void;
  onAdminSignIn: (email: string) => void;
}

export function AuthModal({
  isOpen,
  initialMode = 'signin',
  noticeMessage = null,
  users,
  onClose,
  onUserSignIn,
  onUserSignUp,
  onAdminSignIn,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [error, setError] = useState<string | null>(null);

  // Sign In fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Sign Up fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Admin fields
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const switchMode = (next: AuthModalMode) => {
    setMode(next);
    setError(null);
  };

  const handleUserSignInSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = loginEmail.trim().toLowerCase();
    const found = users.find(
      (u) => u.email.toLowerCase() === cleanEmail && u.password === loginPassword
    );
    if (!found) {
      setError('Invalid Gmail or password. Please check your credentials or create an account.');
      return;
    }
    setError(null);
    setLoginPassword('');
    onUserSignIn(found);
    onClose();
  };

  const handleSignUpSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleanName = regName.trim();
    const cleanEmail = regEmail.trim().toLowerCase();
    const cleanPhone = regPhone.trim();

    if (!cleanName || !cleanEmail || !cleanPhone || regPassword.length < 4) {
      setError('Please fill in all fields (password minimum 4 characters).');
      return;
    }

    if (cleanEmail === ADMIN_EMAIL.toLowerCase()) {
      setError('This email is reserved. Please use a customer Gmail address.');
      return;
    }

    const exists = users.some((u) => u.email.toLowerCase() === cleanEmail);
    if (exists) {
      setError('An account with this Gmail already exists. Please sign in instead.');
      return;
    }

    const newUser: RegisteredUser = {
      id: `usr-${Date.now()}`,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      password: regPassword,
      createdAt: new Date().toISOString(),
    };

    setError(null);
    setRegName('');
    setRegEmail('');
    setRegPhone('');
    setRegPassword('');
    onUserSignUp(newUser);
    onClose();
  };

  const handleAdminSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = adminEmail.trim().toLowerCase();
    if (cleanEmail !== ADMIN_EMAIL.toLowerCase() || adminPassword !== ADMIN_PASSWORD) {
      setError('Invalid Admin email or password.');
      return;
    }
    setError(null);
    setAdminEmail('');
    setAdminPassword('');
    onAdminSignIn(ADMIN_EMAIL);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md rounded-xl bg-[#131820] border border-white/10 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-white/[0.08]">
              <div>
                <h2
                  id="auth-modal-title"
                  className="font-display text-lg font-semibold text-zinc-100"
                >
                  {mode === 'signin'
                    ? 'Customer Sign In'
                    : mode === 'signup'
                    ? 'Create an Account'
                    : 'Admin Sign In'}
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {mode === 'signin'
                    ? 'Sign in with your registered Gmail and password'
                    : mode === 'signup'
                    ? 'Register once to save your orders and 15-day timer'
                    : 'Website owner access to manage packages & orders'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close authentication modal"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              {noticeMessage && !error && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-lg bg-amber-400/10 border border-amber-400/30 p-3.5 text-xs font-medium text-amber-300"
                >
                  <Lock className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" aria-hidden="true" />
                  <span>{noticeMessage}</span>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg bg-red-500/10 border border-red-500/30 p-3.5 text-xs font-medium text-red-300"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              {mode === 'signin' && (
                <form onSubmit={handleUserSignInSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="login-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Gmail
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="you@gmail.com"
                      className="w-full min-h-[44px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label htmlFor="login-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Password
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full min-h-[44px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[44px] rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-amber-300 transition-colors"
                  >
                    Sign In
                  </button>

                  {/* Directly below Sign In button: Create an Account */}
                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => switchMode('signup')}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-300 hover:text-amber-200 transition-colors"
                    >
                      <UserPlus className="w-4 h-4" aria-hidden="true" />
                      <span>Create an Account</span>
                    </button>
                  </div>
                </form>
              )}

              {mode === 'signup' && (
                <form onSubmit={handleSignUpSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="reg-name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Full Name
                    </label>
                    <input
                      id="reg-name"
                      type="text"
                      required
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Alex Johnson"
                      className="w-full min-h-[44px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label htmlFor="reg-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Gmail
                    </label>
                    <input
                      id="reg-email"
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="you@gmail.com"
                      className="w-full min-h-[44px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label htmlFor="reg-phone" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Phone Number
                    </label>
                    <input
                      id="reg-phone"
                      type="tel"
                      required
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      placeholder="+880 1XXX-XXXXXX"
                      className="w-full min-h-[44px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label htmlFor="reg-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Password
                    </label>
                    <input
                      id="reg-password"
                      type="password"
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Minimum 4 characters"
                      className="w-full min-h-[44px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[44px] rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-amber-300 transition-colors"
                  >
                    Create Account &amp; Sign In
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      Already have an account? Sign In
                    </button>
                  </div>
                </form>
              )}

              {mode === 'admin' && (
                <form onSubmit={handleAdminSubmit} className="space-y-4">
                  <div className="rounded-lg bg-[#0D1117] border border-amber-400/20 p-3.5 flex items-center gap-2.5 text-xs text-amber-300">
                    <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Restricted Website Owner / Admin Login</span>
                  </div>

                  <div>
                    <label htmlFor="admin-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Admin Email
                    </label>
                    <input
                      id="admin-email"
                      name="admin-email"
                      type="email"
                      required
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="Enter admin email"
                      autoComplete="off"
                      className="w-full min-h-[44px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label htmlFor="admin-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Admin Password
                    </label>
                    <input
                      id="admin-password"
                      name="admin-password"
                      type="password"
                      required
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Enter admin password"
                      autoComplete="new-password"
                      className="w-full min-h-[44px] rounded-lg bg-[#090B0E] border border-white/10 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full min-h-[44px] rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-white transition-colors"
                  >
                    Sign In as Admin
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      Back to Customer Sign In
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Clearly separated Admin Sign In option at bottom of modal */}
            {mode !== 'admin' && (
              <div className="px-6 py-4 bg-[#0D1117] border-t border-white/[0.08] flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">Store Administrator?</span>
                <button
                  type="button"
                  onClick={() => switchMode('admin')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300 hover:text-amber-300 transition-colors"
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Admin Sign In</span>
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
