'use client';

import React, { useState } from 'react';
import { MarketplaceSku, ProductVariant, Product, UserRole } from '@/types/database';
import { Search, ShoppingBag, ExternalLink, Filter, Layers } from 'lucide-react';

interface MarketplacesModuleProps {
  marketplaceSkus: (MarketplaceSku & {
    variant: ProductVariant & { product: Product };
  })[];
  currentRole: UserRole;
}

export function MarketplacesModule({ marketplaceSkus, currentRole }: MarketplacesModuleProps) {
  const [channelFilter, setChannelFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSkus = marketplaceSkus.filter((item) => {
    const matchesChannel = channelFilter === 'ALL' || item.platform === channelFilter;
    const matchesSearch =
      item.marketplace_sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.variant?.product?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.variant?.product?.sku.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesChannel && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">
          Mapeamento de SKUs em Marketplaces
        </h2>
        <p className="text-xs text-slate-500">
          Vinculação das variações físicas aos identificadores de anúncio no TikTok Shop, Shopee e SHEIN.
        </p>
      </div>

      {/* Cards de Plataformas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">TikTok Shop</span>
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
              Canal 01
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {marketplaceSkus.filter((m) => m.platform === 'TIKTOK_SHOP').length} SKUs
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Sincronização de catálogo ativa</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-600">Shopee</span>
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">
              Canal 02
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {marketplaceSkus.filter((m) => m.platform === 'SHOPEE').length} SKUs
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Anúncios sincronizados</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">SHEIN</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
              Canal 03
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {marketplaceSkus.filter((m) => m.platform === 'SHEIN').length} SKUs
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Catálogo internacional / nacional</p>
        </div>
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
              placeholder="Buscar por SKU do marketplace ou produto..."
              className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400 shrink-0" />
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 py-2 px-3 text-xs text-slate-700 focus:border-slate-900 focus:outline-hidden bg-white"
            >
              <option value="ALL">Todos os Canais</option>
              <option value="TIKTOK_SHOP">Apenas TikTok Shop</option>
              <option value="SHOPEE">Apenas Shopee</option>
              <option value="SHEIN">Apenas SHEIN</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabela de Mapeamento */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3.5 px-4 font-bold">Plataforma / Canal</th>
                <th className="py-3.5 px-4 font-bold">SKU no Marketplace</th>
                <th className="py-3.5 px-4 font-bold">Produto Vinculado</th>
                <th className="py-3.5 px-4 font-bold">Cor & Tam Físicos</th>
                <th className="py-3.5 px-4 font-bold text-right">Saldo Físico Atual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSkus.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    Nenhum SKU encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredSkus.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-bold">
                      {item.platform === 'TIKTOK_SHOP' && (
                        <span className="inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                          TikTok Shop
                        </span>
                      )}
                      {item.platform === 'SHOPEE' && (
                        <span className="inline-flex items-center rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700 border border-orange-200">
                          Shopee
                        </span>
                      )}
                      {item.platform === 'SHEIN' && (
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-800 border border-slate-200">
                          SHEIN
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      {item.marketplace_sku}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {item.variant?.product?.name}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {item.variant?.color} • Tam {item.variant?.size}
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-slate-900">
                      {item.variant?.stock_quantity} un
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

