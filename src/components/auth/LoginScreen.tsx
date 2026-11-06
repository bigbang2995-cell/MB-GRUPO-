'use client';

/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Tela de Login Corporativa com Perfis de Teste Padronizados
 * ETAPA 8 — PASSO 3
 *
 * Atualizações Obrigatórias (Passo 3):
 * - Nomes fictícios (Marcelo, Carlos, Mariana, Rodrigo) REMOVIDOS.
 * - Disponibiliza exclusivamente 'Administrador' e 'Operador' na demonstração local.
 * - Atalhos de teste desativados em ambiente de produção (NODE_ENV === 'production').
 * - Validação e suporte direto a contas de funcionários criadas pelo Administrador.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  Shield,
  User,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Info,
} from 'lucide-react';

export function LoginScreen() {
  const router = useRouter();
  const { signIn, error, clearError, isDemoMode, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const emailInputRef = useRef<HTMLInputElement>(null);

  // Redireciona usuário autenticado para o Dashboard evitando tela de login residual
  useEffect(() => {
    if (isAuthenticated && typeof window !== 'undefined' && window.location.pathname === '/login') {
      router.replace('/');
    }
  }, [isAuthenticated, router]);

  // Foco automático seguro executado no cliente após montagem, sem causar Hydration Warning
  useEffect(() => {
    emailInputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!email.trim()) {
      setLocalError('Por favor, informe seu e-mail corporativo.');
      return;
    }
    if (!password) {
      setLocalError('Por favor, informe sua senha.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signIn(email, password);
      if (result.success) {
        if (typeof window !== 'undefined' && window.location.pathname === '/login') {
          router.replace('/');
        }
      } else {
        setLocalError(result.error || 'Credenciais inválidas.');
      }
    } catch {
      setLocalError('Erro inesperado durante a autenticação.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Preenchimento rápido para o ambiente de testes/homologação local
   */
  const handleSelectDemoUser = (userEmail: string, demoPass: string) => {
    setEmail(userEmail);
    setPassword(demoPass);
    setLocalError(null);
    clearError();
  };

  const activeError = localError || error;

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 p-4 sm:p-6 text-slate-100">
      {/* Container Central de Login */}
      <div className="w-full max-w-md">
        {/* Banner Explícito de Simulação Local */}
        {isDemoMode && (
          <div className="mb-4 bg-amber-500/15 border border-amber-500/30 rounded-2xl p-3 text-amber-200 text-xs shadow-lg backdrop-blur-xs">
            <div className="flex items-center gap-2 font-bold text-amber-300">
              <Sparkles className="h-4 w-4 shrink-0" />
              <span>AMBIENTE DE HOMOLOGAÇÃO LOCAL (SIMULAÇÃO)</span>
            </div>
            <p className="mt-1 text-[11px] text-amber-200/80 leading-relaxed">
              Demonstração local isolada. Credenciais de teste restritas ao ambiente de desenvolvimento. Não conectado ao banco de produção.
            </p>
          </div>
        )}

        {/* Card Principal */}
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden text-slate-900">
          {/* Cabeçalho do Card */}
          <div className="bg-slate-950 px-8 pt-8 pb-7 text-center relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-blue-600/10 blur-2xl pointer-events-none" />
            <div className="absolute -bottom-12 -left-12 w-32 h-32 rounded-full bg-amber-500/10 blur-2xl pointer-events-none" />

            <div className="inline-flex p-3 bg-white rounded-2xl shadow-md mb-4">
              <img
                src="/images/mb-logo-cart.jpg"
                alt="MB Grupo"
                className="h-10 w-10 object-contain rounded-lg"
              />
            </div>
            <h1 className="text-xl font-black tracking-tight text-white">
              Estoque Digital — MB Grupo
            </h1>
            <p className="text-xs text-slate-400 mt-1 font-medium">
              Acesso corporativo individual ao sistema de estoque
            </p>
          </div>

          {/* Formulário */}
          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            {/* Alerta de Erro */}
            {activeError && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-start gap-2.5 text-rose-800 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                <div className="flex-1 font-medium">{activeError}</div>
              </div>
            )}

            {/* Campo E-mail */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                E-mail Corporativo
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  ref={emailInputRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@mbgrupo.com.br"
                  required
                  className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-slate-400 text-slate-800 font-medium"
                />
              </div>
            </div>

            {/* Campo Senha */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 block">
                  Senha
                </label>
                <span className="text-[10px] text-slate-400">
                  Protegida por SHA-256
                </span>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-slate-400 text-slate-800 font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Botão de Entrar */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-black active:scale-[0.99] disabled:opacity-50 transition-all shadow-md shadow-slate-900/10 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Validando credenciais...</span>
                </>
              ) : (
                <>
                  <span>Entrar no Sistema</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Perfis de Teste Padronizados (Exibidos exclusivamente no modo Demonstração) */}
          {isDemoMode && (
            <div className="bg-slate-50 px-8 py-5 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 mb-3 uppercase tracking-wider">
                <Info className="h-3.5 w-3.5 text-blue-600" />
                <span>Perfis de Demonstração Local (Clique para testar)</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* Administrador */}
                <button
                  type="button"
                  onClick={() => handleSelectDemoUser('admin@mbgrupo.com.br', 'Admin@123')}
                  className="flex flex-col p-2.5 rounded-xl border border-slate-200 bg-white hover:border-amber-400 hover:bg-amber-50/50 transition-all text-left text-xs group cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <div className="p-1 rounded-md bg-amber-100 text-amber-800">
                      <Shield className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                      Admin
                    </span>
                  </div>
                  <div className="font-bold text-slate-800 group-hover:text-amber-900">
                    Administrador
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    admin@mbgrupo.com.br
                  </div>
                </button>

                {/* Operador */}
                <button
                  type="button"
                  onClick={() => handleSelectDemoUser('operador@mbgrupo.com.br', 'Operador@123')}
                  className="flex flex-col p-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/50 transition-all text-left text-xs group cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <div className="p-1 rounded-md bg-blue-100 text-blue-800">
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-[10px] font-bold text-blue-800 bg-blue-100 px-1.5 py-0.5 rounded">
                      Operador
                    </span>
                  </div>
                  <div className="font-bold text-slate-800 group-hover:text-blue-900">
                    Operador
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    operador@mbgrupo.com.br
                  </div>
                </button>
              </div>

              <p className="mt-3 text-[10px] text-slate-400 text-center leading-relaxed">
                Contas criadas em <strong>Configurações → Gerenciar Funcionários</strong> podem acessar digitando login e senha individuais.
              </p>
            </div>
          )}
        </div>

        {/* Rodapé de Segurança */}
        <div className="mt-4 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span>Hashing criptográfico SHA-256 ativo. Sem credenciais em texto puro.</span>
        </div>
      </div>
    </div>
  );
}
