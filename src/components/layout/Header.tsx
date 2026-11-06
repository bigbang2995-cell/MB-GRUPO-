'use client';

import React from 'react';
import { UserRole } from '@/types/database';
import { Shield, User, Database, Sparkles, Layers } from 'lucide-react';

interface HeaderProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Header({ currentRole, onRoleChange, activeTab, onTabChange }: HeaderProps) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'scanner', label: 'Bipagem USB (Prioridade)' },
    { id: 'labels', label: 'Etiquetas & Códigos (Code 128)' },
    { id: 'stock', label: 'Estoque & Produtos' },
    { id: 'movements', label: 'Histórico de Movimentações' },
    { id: 'marketplaces', label: 'Marketplaces (SKUs)' },
    { id: 'settings', label: 'Segurança & Configurações' },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      {/* Top Banner */}
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 font-bold text-white shadow-sm">
            MB
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-slate-900">
                Estoque Digital — MB Grupo
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-200">
                <Sparkles className="h-3 w-3" /> Protótipo Funcional Local
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Modo de Simulação em Memória (Sem conexão de gravação ativa no Supabase)
            </p>
          </div>
        </div>

        {/* User Role Switcher (Para testar permissões interativamente) */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1 text-xs text-slate-600 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <span className="px-2 font-medium text-slate-500">Perfil Ativo:</span>
            <button
              onClick={() => onRoleChange('operator')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                currentRole === 'operator'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <User className="h-3.5 w-3.5 text-blue-600" />
              Operador
            </button>
            <button
              onClick={() => onRoleChange('admin')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                currentRole === 'admin'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Shield className="h-3.5 w-3.5 text-amber-400" />
              Administrador
            </button>
          </div>

          <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 border border-slate-200">
              {currentRole === 'admin' ? 'AD' : 'OP'}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <nav className="flex space-x-1 overflow-x-auto py-1 scrollbar-none" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

