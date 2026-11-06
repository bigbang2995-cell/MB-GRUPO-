'use client';

import React, { useState } from 'react';
import { StockMovement, ProductVariant, Product, UserRole } from '@/types/database';
import {
  History,
  Filter,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';

interface MovementsModuleProps {
  movements: (StockMovement & {
    variant: ProductVariant & { product: Product };
    operatorName: string;
  })[];
  currentRole: UserRole;
}

export function MovementsModule({ movements, currentRole }: MovementsModuleProps) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredMovements = movements.filter((m) => {
    const matchesType = typeFilter === 'ALL' || m.movement_type === typeFilter;
    const matchesSearch =
      m.variant?.product?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.variant?.product?.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.operatorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.note && m.note.toLowerCase().includes(searchTerm.toLowerCase()));

    return matchesType && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header & Local Demonstration Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Histórico de Movimentações (Demonstração Local)
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
              <ShieldAlert className="h-3 w-3 text-amber-600" /> Demonstração Local (Memória)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Registro cronológico em memória local. Toda entrada, saída ou ajuste identifica o operador e saldo antes/depois nesta sessão de demonstração.
          </p>
        </div>
      </div>

      {/* Banner de Esclarecimento de Governança */}
      <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
        <span>
          <strong>Nota de Governança:</strong> Os registros desta sessão são armazenados em memória local no navegador para demonstração funcional e dependem de infraestrutura SQL definitiva para persistência corporativa permanente.
        </span>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por produto, SKU, operador ou justificativa..."
              className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400 shrink-0" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 py-2 px-3 text-xs text-slate-700 focus:border-slate-900 focus:outline-hidden bg-white"
            >
              <option value="ALL">Todos os Tipos de Movimento</option>
              <option value="entry">Entradas (Bipagem / Recebimento)</option>
              <option value="exit">Saídas (Expedição / Separação)</option>
              <option value="adjustment">Ajustes Manuais de Inventário</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabela de Histórico */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3.5 px-4 font-bold">Data & Hora</th>
                <th className="py-3.5 px-4 font-bold">Tipo</th>
                <th className="py-3.5 px-4 font-bold">Produto / Variação</th>
                <th className="py-3.5 px-4 font-bold text-center">Qtd</th>
                <th className="py-3.5 px-4 font-bold text-center">Antes ➔ Depois</th>
                <th className="py-3.5 px-4 font-bold">Operador (created_by)</th>
                <th className="py-3.5 px-4 font-bold">Nota / Justificativa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Nenhuma movimentação encontrada com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => {
                  const isEntry = m.movement_type === 'entry';
                  const isExit = m.movement_type === 'exit';
                  const isAdjustment = m.movement_type === 'adjustment';

                  const formattedDate = new Date(m.created_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {formattedDate}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isEntry && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                            <ArrowDownLeft className="h-3 w-3" /> Entrada
                          </span>
                        )}
                        {isExit && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200">
                            <ArrowUpRight className="h-3 w-3" /> Saída
                          </span>
                        )}
                        {isAdjustment && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                            <RefreshCw className="h-3 w-3" /> Ajuste
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900">{m.variant?.product?.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {m.variant?.color} • Tam {m.variant?.size} • {m.variant?.product?.sku}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-center font-extrabold text-slate-900">
                        {isEntry ? `+${m.quantity}` : isExit ? `-${m.quantity}` : m.quantity}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-xs whitespace-nowrap">
                        <span className="text-slate-400">{m.stock_before}</span>
                        <span className="mx-1 text-slate-300">➔</span>
                        <span className="font-bold text-slate-900">{m.stock_after}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-800 font-medium">
                          <UserCheck className="h-3.5 w-3.5 text-blue-600" />
                          {m.operatorName}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate" title={m.note || ''}>
                        {m.note || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

