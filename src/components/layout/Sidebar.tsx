'use client';

import React from 'react';
import {
  Home,
  Boxes,
  FileText,
  History,
  Barcode,
  Settings,
  ScanBarcode,
  Tags,
  Building2,
  Lock,
  ArrowLeftRight,
} from 'lucide-react';
import { UserRole } from '@/types/database';

interface MenuItem {
  id: string;
  label: string;
  icon: any;
  badge?: string | null;
  adminOnly?: boolean;
}

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentRole?: UserRole;
}

export function Sidebar({ activeTab, onTabChange, currentRole = 'operator' }: SidebarProps) {
  const menuItems: MenuItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: Home,
    },
    {
      id: 'stock',
      label: 'Estoque',
      icon: Boxes,
    },
    {
      id: 'outputs',
      label: 'Registrar saídas',
      icon: FileText,
    },
    {
      id: 'movements',
      label: 'Histórico',
      icon: History,
    },
    {
      id: 'store-transfers',
      label: 'Acerto entre Lojas',
      icon: ArrowLeftRight,
      adminOnly: true,
    },
    {
      id: 'skus',
      label: 'SKUs',
      icon: Barcode,
    },
    {
      id: 'settings',
      label: 'Configurações',
      icon: Settings,
    },
    {
      id: 'scanner',
      label: 'Bipagem',
      icon: ScanBarcode,
      badge: null, // Ativo operacionalmente conforme instrução oficial MB Grupo
    },
    {
      id: 'labels',
      label: 'Etiquetas e Códigos',
      icon: Tags,
    },
  ];

  return (
    <aside className="w-64 shrink-0 bg-[#0d1726] flex flex-col h-screen text-slate-300 select-none z-20 border-r border-slate-800/80">
      {/* Top Header com Logo Oficial MB Grupo */}
      <div className="px-6 pt-7 pb-6 flex items-center gap-3 border-b border-slate-800/60">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-black border border-slate-800 overflow-hidden shadow-md shrink-0">
          <img
            src="/images/mb-logo-cart.jpg"
            alt="MB Grupo"
            className="h-full w-full object-contain"
          />
        </div>
        <div>
          <span className="block text-lg font-black tracking-wider text-white leading-tight">
            MB
          </span>
          <span className="block text-[10px] font-bold tracking-[0.28em] text-slate-400 uppercase leading-none">
            GRUPO
          </span>
        </div>
      </div>

      {/* Menu de Navegação Vertical */}
      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        {menuItems
          .filter((item) => !item.adminOnly || currentRole === 'admin')
          .map((item) => {
            const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              data-tab={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                isActive
                  ? 'bg-[#1b283f] text-white shadow-inner font-bold border-l-4 border-blue-500'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`h-4 w-4 transition-colors ${
                    isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'
                  }`}
                />
                <span>{item.label}</span>
              </div>

              {item.badge && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Rodapé com Informações de Versão do Sistema */}
      <div className="p-4 border-t border-slate-800/60 bg-[#0a121e]">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/90 text-slate-300">
            <Lock className="h-4 w-4" />
          </div>
          <div className="text-[11px] leading-tight">
            <div className="font-bold text-white">MB Grupo</div>
            <div className="text-slate-400 text-[10px]">Sistema de estoque</div>
            <div className="text-slate-500 text-[9px] mt-0.5">v2.0.0</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
