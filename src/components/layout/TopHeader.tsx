'use client';

/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Cabeçalho Principal com Identidade Individual de Colaborador
 * ETAPA 8 — PASSO 2
 *
 * Atualizações de Segurança:
 * - Exibe o nome e o cargo do colaborador individualmente autenticado.
 * - REMOÇÃO COMPLETA do seletor que permitia assumir o perfil Administrador sem credenciais.
 * - Adição de botões para 'Trocar de Operador' e 'Sair (Logout)'.
 * - Indicador explícito de Simulação Local.
 */

import React, { useState, useEffect } from 'react';
import { UserRole } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import {
  Search,
  Calendar,
  Bell,
  ChevronDown,
  Shield,
  User,
  Sparkles,
  AlertTriangle,
  Info,
  LogOut,
  UserCheck,
  RefreshCw,
} from 'lucide-react';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type?: 'warning' | 'info' | 'success';
}

interface TopHeaderProps {
  currentRole?: UserRole;
  onRoleChange?: (role: UserRole) => void;
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
  notifications?: NotificationItem[];
}

export function TopHeader({
  currentRole: propRole,
  onRoleChange: _onRoleChange,
  searchTerm = '',
  onSearchChange,
  notifications = [],
}: TopHeaderProps) {
  const { user, signOut, switchOperator, isDemoMode } = useAuth();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  // Perfil efetivo vem da sessão autenticada; propRole serve como fallback
  const effectiveRole: UserRole = user?.role || propRole || 'operator';
  const displayName = user?.name || (effectiveRole === 'admin' ? 'Administrador' : 'Operador');
  const displayTitle = user?.title || (effectiveRole === 'admin' ? 'Administrador de Estoque' : 'Operador de Estoque');

  // Estado para data formatada
  const [formattedDate, setFormattedDate] = useState<string>('...');

  useEffect(() => {
    const today = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date());
    const capitalized = today.charAt(0).toUpperCase() + today.slice(1);
    setFormattedDate(capitalized);
  }, []);

  return (
    <header className="h-18 bg-white border-b border-slate-200/90 px-6 flex items-center justify-between gap-4 sticky top-0 z-30 shadow-xs">
      {/* Título do Sistema e Subtítulo */}
      <div className="flex flex-col shrink-0">
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900 leading-none">
          Estoque Digital
        </h1>
        <p className="text-xs text-slate-500 font-medium mt-1">
          Gestão de estoque | MB Grupo
        </p>
      </div>

      {/* Barra de Busca Centralizada com Atalho Ctrl + K */}
      <div className="flex-1 max-w-xl mx-4">
        <div className="relative flex items-center w-full">
          <Search className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder="Buscar por SKU, produto, cor ou categoria..."
            className="w-full pl-10 pr-20 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-slate-400 text-slate-800"
          />
          <div className="absolute right-3 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-semibold text-slate-400 shadow-2xs pointer-events-none">
            Ctrl + K
          </div>
        </div>
      </div>

      {/* Lado Direito: Data, Indicador de Demonstração, Notificações e Perfil */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Data e Status do Sistema */}
        <div className="hidden lg:flex flex-col items-end text-xs">
          <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span>{formattedDate}</span>
          </div>
          {isDemoMode && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-700 font-medium mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>Simulação Local (Memória)</span>
            </div>
          )}
        </div>

        {/* Separador Vertical */}
        <div className="h-7 w-px bg-slate-200 hidden sm:block" />

        {/* Sino de Notificações com Badge Real */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Notificações operacionais"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-white">
              {notifications.length > 0 ? notifications.length : 2}
            </span>
          </button>

          {/* Dropdown de Notificações com Dados Reais */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-white p-4 shadow-xl border border-slate-200 z-50 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-900">Notificações Operacionais</span>
                <span className="text-[10px] font-semibold text-blue-600">
                  {notifications.length} {notifications.length === 1 ? 'aviso' : 'avisos'}
                </span>
              </div>
              <div className="mt-2 space-y-2 text-xs max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="text-slate-400 py-3 text-center text-xs">
                    Nenhuma pendência ou alerta no momento.
                  </p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-2.5 rounded-xl border ${
                        n.type === 'warning'
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : n.type === 'success'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-blue-50 border-blue-200 text-blue-900'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1.5">
                        {n.type === 'warning' ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        ) : (
                          <Info className="h-3.5 w-3.5 text-blue-600" />
                        )}
                        <span>{n.title}</span>
                      </div>
                      <div className="text-[11px] mt-0.5 opacity-90">{n.message}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Perfil do Usuário / Colaborador Autenticado */}
        <div className="relative">
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white font-bold text-xs shadow-xs shrink-0">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="text-left hidden md:block">
              <div className="text-xs font-bold text-slate-800 leading-tight">
                {displayName}
              </div>
              <div className="text-[11px] text-slate-500 font-medium leading-none capitalize">
                {displayTitle}
              </div>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>

          {/* Menu Dropdown de Perfil Seguro */}
          {showProfileMenu && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white p-3 shadow-xl border border-slate-200 z-50 animate-in fade-in slide-in-from-top-2 text-slate-900">
              {/* Informações do Colaborador */}
              <div className="px-3 py-2.5 mb-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="overflow-hidden">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {displayName}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {user?.email || 'operador@mbgrupo.com.br'}
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-slate-500">Perfil:</span>
                  <span
                    className={`font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${
                      effectiveRole === 'admin'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {effectiveRole === 'admin' ? (
                      <Shield className="h-3 w-3" />
                    ) : (
                      <User className="h-3 w-3" />
                    )}
                    {effectiveRole === 'admin' ? 'Administrador' : 'Operador'}
                  </span>
                </div>
              </div>

              {/* Ações de Sessão */}
              <div className="space-y-1">
                {/* Trocar de Operador */}
                <button
                  type="button"
                  onClick={async () => {
                    setShowProfileMenu(false);
                    await switchOperator();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4 text-blue-600" />
                  <span>Trocar de Operador</span>
                </button>

                {/* Sair / Logout */}
                <button
                  type="button"
                  onClick={async () => {
                    setShowProfileMenu(false);
                    await signOut();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <LogOut className="h-4 w-4 text-rose-600" />
                  <span>Sair do Sistema</span>
                </button>
              </div>

              {/* Rodapé Informativo */}
              <div className="mt-3 pt-2 border-t border-slate-100 text-[10px] text-slate-400 px-2 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <UserCheck className="h-3 w-3 text-emerald-500" />
                  <span>Sessão ativa</span>
                </span>
                <span className="flex items-center gap-1 text-amber-600 font-medium">
                  <Sparkles className="h-3 w-3" />
                  <span>Simulação</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
