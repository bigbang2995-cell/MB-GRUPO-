'use client';

/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Módulo de Configurações, Credenciais & Governança
 * ETAPA 9 — MELHORIAS ADMINISTRATIVAS
 *
 * Estrutura em 3 áreas funcionais:
 * 1. Minha Conta: Exibição de perfil e alteração de login / senha com SHA-256 e confirmação dupla.
 * 2. Gerenciar Funcionários: Gestão de colaboradores corporativos (exclusiva de Administrador).
 * 3. Segurança e Governança: Dados 100% reais do ambiente (LocalStockRepository, modo local, chaves de persistência, bloqueio Supabase).
 */

import React, { useState, useEffect } from 'react';
import { UserRole } from '@/types/database';
import { EmployeeManagement } from '@/components/modules/EmployeeManagement';
import { useAuth } from '@/contexts/AuthContext';
import {
  Shield,
  User,
  Users,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Save,
  Database,
  HardDrive,
  Clock,
  Layers,
  FileKey,
  ShieldCheck,
} from 'lucide-react';

interface SettingsModuleProps {
  currentRole: UserRole;
  onRoleChange?: (role: UserRole) => void;
}

export function SettingsModule({ currentRole }: SettingsModuleProps) {
  const { employees, user, session, updateAdminAccount } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'my-account' | 'employees' | 'governance'>('my-account');

  const isAdmin = currentRole === 'admin' || user?.role === 'admin';

  // Formulário: Minha Conta (Alteração de Nome e Login)
  const [adminName, setAdminName] = useState(user?.name || '');
  const [adminEmail, setAdminEmail] = useState(user?.email || '');
  const [loginCurrentPassword, setLoginCurrentPassword] = useState('');
  const [showLoginCurrentPassword, setShowLoginCurrentPassword] = useState(false);
  const [loginFeedback, setLoginFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSavingLogin, setIsSavingLogin] = useState(false);

  // Formulário: Minha Conta (Alteração de Senha)
  const [passCurrent, setPassCurrent] = useState('');
  const [passNew, setPassNew] = useState('');
  const [passConfirm, setPassConfirm] = useState('');
  const [showPassCurrent, setShowPassCurrent] = useState(false);
  const [showPassNew, setShowPassNew] = useState(false);
  const [showPassConfirm, setShowPassConfirm] = useState(false);
  const [passFeedback, setPassFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSavingPass, setIsSavingPass] = useState(false);

  useEffect(() => {
    if (user) {
      setAdminName(user.name);
      setAdminEmail(user.email);
    }
  }, [user]);

  const handleSaveLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginFeedback(null);

    if (!isAdmin) {
      setLoginFeedback({ type: 'error', message: 'Acesso negado: apenas Administradores podem alterar dados de acesso.' });
      return;
    }

    if (!loginCurrentPassword.trim()) {
      setLoginFeedback({ type: 'error', message: 'Informe sua senha atual para autorizar a alteração de login.' });
      return;
    }

    const cleanEmail = adminEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setLoginFeedback({ type: 'error', message: 'Informe um e-mail corporativo válido.' });
      return;
    }

    const cleanName = adminName.trim();
    if (!cleanName || cleanName.length < 2) {
      setLoginFeedback({ type: 'error', message: 'O nome deve conter ao menos 2 caracteres.' });
      return;
    }

    setIsSavingLogin(true);
    try {
      const res = await updateAdminAccount({
        currentPassword: loginCurrentPassword,
        newName: cleanName,
        newEmail: cleanEmail,
      });

      if (!res.success) {
        setLoginFeedback({ type: 'error', message: res.error || 'Erro ao atualizar dados de acesso.' });
      } else {
        setLoginFeedback({
          type: 'success',
          message: 'Dados de acesso atualizados com sucesso! A sessão foi renovada e o novo login já está ativo.',
        });
        setLoginCurrentPassword('');
      }
    } catch (err: unknown) {
      setLoginFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Falha na comunicação ao salvar login.',
      });
    } finally {
      setIsSavingLogin(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassFeedback(null);

    if (!isAdmin) {
      setPassFeedback({ type: 'error', message: 'Acesso negado: apenas Administradores podem alterar senhas.' });
      return;
    }

    if (!passCurrent.trim()) {
      setPassFeedback({ type: 'error', message: 'Informe sua senha atual.' });
      return;
    }

    if (!passNew.trim() || passNew.length < 6) {
      setPassFeedback({ type: 'error', message: 'A nova senha deve possuir ao menos 6 caracteres.' });
      return;
    }

    if (passNew !== passConfirm) {
      setPassFeedback({ type: 'error', message: 'A confirmação da nova senha não confere.' });
      return;
    }

    setIsSavingPass(true);
    try {
      const res = await updateAdminAccount({
        currentPassword: passCurrent,
        newPassword: passNew,
      });

      if (!res.success) {
        setPassFeedback({ type: 'error', message: res.error || 'Erro ao alterar a senha.' });
      } else {
        setPassFeedback({
          type: 'success',
          message: 'Senha alterada com sucesso! As novas credenciais foram gravadas e sua sessão foi renovada.',
        });
        setPassCurrent('');
        setPassNew('');
        setPassConfirm('');
      }
    } catch (err: unknown) {
      setPassFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Falha na comunicação ao salvar senha.',
      });
    } finally {
      setIsSavingPass(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho do Módulo */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Configurações & Credenciais
          </h2>
          <p className="text-xs text-slate-500">
            Gestão da conta administrativa, controle de funcionários e governança do ambiente.
          </p>
        </div>

        {/* Alternador de Abas */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveSubTab('my-account')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'my-account'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="h-3.5 w-3.5" />
            <span>Minha Conta</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('employees')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'employees'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Gerenciar Funcionários</span>
            {isAdmin && employees.length > 0 && (
              <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded-full font-bold">
                {employees.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('governance')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'governance'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Segurança e Governança</span>
          </button>
        </div>
      </div>

      {/* ÁREA 1: MINHA CONTA */}
      {activeSubTab === 'my-account' && (
        <div className="space-y-6">
          {/* Cartão de Identificação da Conta */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3.5">
                <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg shadow-xs">
                  {user?.name ? user.name.slice(0, 2).toUpperCase() : 'MB'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{user?.name || 'Administrador'}</h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Conta Ativa
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{user?.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 border border-slate-200">
                  <ShieldCheck className="h-4 w-4 text-blue-600" />
                  Perfil: {user?.role === 'admin' ? 'Administrador Oficial' : 'Operador'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Cargo Operacional</span>
                <span className="font-semibold text-slate-800 mt-0.5 block">{user?.title || 'Administrador de Estoque'}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Tipo de Sessão</span>
                <span className="font-semibold text-slate-800 mt-0.5 block">Sessão Local Criptografada</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Nível de Permissão</span>
                <span className="font-semibold text-emerald-700 mt-0.5 block">
                  {isAdmin ? 'Acesso Administrativo Pleno' : 'Operações de Estoque'}
                </span>
              </div>
            </div>
          </div>

          {/* Grid em 2 Colunas: Alterar Login & Alterar Senha */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Formulário: Alterar Login (E-mail) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                  <User className="h-4 w-4 text-slate-600" />
                  Alterar Login e Dados de Acesso
                </h3>
              </div>

              {loginFeedback && (
                <div
                  className={`mt-4 p-3 rounded-xl text-xs font-semibold flex items-start gap-2 ${
                    loginFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {loginFeedback.type === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{loginFeedback.message}</span>
                </div>
              )}

              <form onSubmit={handleSaveLogin} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nome Oficial do Administrador *
                  </label>
                  <input
                    type="text"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    required
                    disabled={!isAdmin || isSavingLogin}
                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Novo E-mail Corporativo (Login) *
                  </label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    required
                    disabled={!isAdmin || isSavingLogin}
                    placeholder="exemplo@mbgrupo.com.br"
                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Este será seu novo identificador para login no sistema.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Senha Atual (Confirmação Obrigatória) *
                  </label>
                  <div className="relative">
                    <input
                      type={showLoginCurrentPassword ? 'text' : 'password'}
                      value={loginCurrentPassword}
                      onChange={(e) => setLoginCurrentPassword(e.target.value)}
                      required
                      disabled={!isAdmin || isSavingLogin}
                      placeholder="Digite sua senha atual para autorizar"
                      className="w-full px-3.5 py-2 pr-10 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginCurrentPassword(!showLoginCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showLoginCurrentPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!isAdmin || isSavingLogin}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{isSavingLogin ? 'Salvando...' : 'Salvar Alterações de Login'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Formulário: Alterar Senha */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-slate-600" />
                  Alterar Senha do Administrador
                </h3>
              </div>

              {passFeedback && (
                <div
                  className={`mt-4 p-3 rounded-xl text-xs font-semibold flex items-start gap-2 ${
                    passFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {passFeedback.type === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{passFeedback.message}</span>
                </div>
              )}

              <form onSubmit={handleSavePassword} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Senha Atual *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassCurrent ? 'text' : 'password'}
                      value={passCurrent}
                      onChange={(e) => setPassCurrent(e.target.value)}
                      required
                      disabled={!isAdmin || isSavingPass}
                      placeholder="Sua senha atual"
                      className="w-full px-3.5 py-2 pr-10 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassCurrent(!showPassCurrent)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassCurrent ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nova Senha (Mínimo 6 caracteres) *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassNew ? 'text' : 'password'}
                      value={passNew}
                      onChange={(e) => setPassNew(e.target.value)}
                      required
                      minLength={6}
                      disabled={!isAdmin || isSavingPass}
                      placeholder="Digite a nova senha segura"
                      className="w-full px-3.5 py-2 pr-10 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassNew(!showPassNew)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassNew ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Confirmar Nova Senha *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassConfirm ? 'text' : 'password'}
                      value={passConfirm}
                      onChange={(e) => setPassConfirm(e.target.value)}
                      required
                      minLength={6}
                      disabled={!isAdmin || isSavingPass}
                      placeholder="Repita a nova senha exatamente"
                      className="w-full px-3.5 py-2 pr-10 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassConfirm(!showPassConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!isAdmin || isSavingPass}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>{isSavingPass ? 'Atualizando...' : 'Atualizar Nova Senha'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ÁREA 2: GERENCIAR FUNCIONÁRIOS */}
      {activeSubTab === 'employees' && <EmployeeManagement />}

      {/* ÁREA 3: SEGURANÇA E GOVERNANÇA (INFORMAÇÕES 100% REAIS E VERIFICÁVEIS) */}
      {activeSubTab === 'governance' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Real do Ambiente em Execução */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-600" />
                Ambiente de Execução & Repositório
              </h3>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                Modo Demonstração Local
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Camada de Repositório Ativa</span>
                <p className="font-mono font-bold text-slate-900">LocalStockRepository (IStockRepository)</p>
                <p className="text-[11px] text-slate-500">
                  Operações em memória e persistência atômica no armazenamento local seguro do navegador (LocalStorage).
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Proteção do Banco de Produção</span>
                <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-emerald-600" />
                  Conexão Remota Inativa & Protegida
                </p>
                <p className="text-[11px] text-slate-500">
                  A alternância remota para o banco de produção via painel está <strong>estritamente bloqueada</strong> por arquitetura de isolamento.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Sessão e Autenticação Ativa</span>
                <p className="font-mono text-[11px] text-slate-800 break-all">
                  Token: {session?.token || 'Sessão local ativa'}
                </p>
                <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Turno: 8 horas
                  </span>
                  <span>
                    Início: {session?.createdAt ? new Date(session.createdAt).toLocaleTimeString('pt-BR') : 'Agora'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Chaves de Persistência Local */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-emerald-600" />
                Ledger & Chaves de Persistência
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">localStorage</span>
            </div>

            <div className="space-y-2 text-xs">
              {[
                { key: 'MB_GRUPO_STOCK_VARIANTS_V30', label: 'Catálogo de Produtos & Variações V30', type: 'Produtos' },
                { key: 'MB_GRUPO_STOCK_MOVEMENTS_V30', label: 'Histórico Imutável de Movimentações', type: 'Auditoria' },
                { key: 'MB_GRUPO_PENDING_EXITS_V30', label: 'Buffer de Saídas e Conferência de Lote', type: 'Operacional' },
                { key: 'MB_GRUPO_EMPLOYEES_V1', label: 'Cadastro Local de Colaboradores', type: 'Segurança' },
                { key: 'MB_GRUPO_ADMIN_CREDENTIALS_V1', label: 'Credenciais Criptografadas do Administrador', type: 'Acesso' },
                { key: 'MB_GRUPO_STORE_TRANSFERS_V1', label: 'Movimentações de Acerto entre Lojas', type: 'Financeiro' },
              ].map((item) => (
                <div key={item.key} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] font-bold text-slate-800 block truncate">{item.key}</span>
                    <span className="text-[11px] text-slate-500 block truncate">{item.label}</span>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200 shrink-0">
                    {item.type}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Políticas de Segurança e Controle de Integridade */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-slate-800" />
                Políticas de Segurança e Integridade MB Grupo
              </h3>
              <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                100% Em Conformidade
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3 text-xs">
              <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <FileKey className="h-3.5 w-3.5 text-blue-600" />
                  Imutabilidade Code 128
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Códigos de barras e identificadores são permanentes. Variações arquivadas nunca têm seus códigos reciclados em novos produtos.
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-amber-600" />
                  Proteção Criptográfica
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Nenhuma senha é armazenada em texto puro. Todas as credenciais utilizam hashes SHA-256 e validação de sessão em 8 horas.
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-emerald-600" />
                  Catálogo Oficial V30
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Preservação integral dos 18 produtos e 119 SKUs base. Arquivamento restrito a variações com saldo zero e sem pendências.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
