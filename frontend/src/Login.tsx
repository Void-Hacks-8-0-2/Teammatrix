import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  Lock,
  User,
  AlertCircle,
  Eye,
  EyeOff,
  Terminal,
  KeyRound,
  CheckCircle2,
  HardDrive,
  Cpu,
} from 'lucide-react';
import { setOfficerSession } from './api';

interface LoginProps {
  onLoginSuccess?: (token: string, username: string) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('Please enter both Officer Badge ID / Username and Password.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      // Standard OAuth2 form submission
      const formData = new URLSearchParams();
      formData.append('username', username.trim());
      formData.append('password', password);

      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Authentication failed. Please verify your officer credentials.');
      }

      // Store in session storage
      setOfficerSession(data.access_token, data.officer, data.role);

      if (onLoginSuccess) {
        onLoginSuccess(data.access_token, data.officer);
      }

      // Route to dashboard
      navigate('/', { replace: true });
    } catch (err: any) {
      console.error('Login error:', err);
      setErrorMsg(err.message || 'Unable to connect to the local authentication engine.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemoFill = () => {
    setUsername('officer_admin');
    setPassword('Cyber@Cell2026');
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 relative overflow-hidden font-sans">
      {/* Background Cyber Grid Graphic */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-40 pointer-events-none" />

      {/* Subtle Ambient Glows */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Header Emblem */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="relative mb-3">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-indigo-900 to-slate-900 border border-indigo-500/40 shadow-xl shadow-indigo-950/80 flex items-center justify-center">
              <Shield className="h-9 w-9 text-indigo-400" />
            </div>
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-slate-950"></span>
            </span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-950/60 border border-indigo-800/50 text-[11px] font-mono text-indigo-300 font-semibold tracking-wide uppercase mb-2">
            <Cpu className="h-3 w-3 text-cyan-400" />
            Operation Abhedya-Chakra
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Forensic Intelligence Portal
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            Cyber Crime Police Cell & Financial Intelligence Unit
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900/90 border border-slate-800 shadow-2xl rounded-2xl p-7 backdrop-blur-xl">
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-800">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-indigo-400" />
              Officer Authentication
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-mono bg-emerald-950/60 border border-emerald-800/40 text-emerald-400 px-2 py-0.5 rounded">
              <HardDrive className="h-2.5 w-2.5" />
              100% Offline
            </span>
          </div>

          {errorMsg && (
            <div className="mb-5 p-3 rounded-lg bg-rose-950/50 border border-rose-800/50 flex items-start gap-2.5 text-xs text-rose-200">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{errorMsg}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-mono font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Officer Username / Badge ID
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. officer_admin"
                  required
                  autoFocus
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950/80 border border-slate-700/80 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Officer Passphrase / Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter secure password"
                  required
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-950/80 border border-slate-700/80 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Verifying Officer Credentials...</span>
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4" />
                  <span>Authenticate & Enter Workbench</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Pre-fill Box for Judges & Evaluators */}
          <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400 font-mono text-[11px]">Pre-Provisioned Account:</span>
            <button
              type="button"
              onClick={handleQuickDemoFill}
              className="text-[11px] font-mono text-indigo-400 hover:text-indigo-300 underline underline-offset-2 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              Autofill (officer_admin)
            </button>
          </div>
        </div>

        {/* CLI Provisioning Notice */}
        <div className="mt-4 p-3 rounded-xl bg-slate-900/60 border border-slate-800/70 text-[11px] text-slate-400 font-mono flex items-start gap-2.5">
          <Terminal className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
          <div>
            <span className="text-slate-200 font-semibold">Offline CLI User Management:</span>
            <p className="mt-0.5 text-slate-400">
              Provision or update officer accounts directly via terminal using:
              <code className="text-cyan-300 bg-slate-950 px-1 py-0.5 rounded ml-1">
                python add_officer.py &lt;user&gt; &lt;pass&gt;
              </code>
            </p>
          </div>
        </div>

        {/* Statutory Warning */}
        <p className="text-[10px] text-center text-slate-400 mt-4 leading-relaxed font-mono px-4">
          RESTRICTED LAW ENFORCEMENT ACCESS ONLY. Access is audited under Sections 43 & 66 of the Information Technology Act, 2000.
        </p>
      </div>
    </div>
  );
}
