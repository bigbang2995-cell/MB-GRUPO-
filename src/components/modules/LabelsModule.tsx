'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ProductVariant, Product, UserRole } from '@/types/database';
import {
  BarcodeLabelCard,
  SingleLabel40x30,
  LabelPairRow82x30,
} from '@/components/modules/BarcodeLabelCard';
import {
  downloadLabelsPdf,
  openLabelsPdfInNewTab,
  LabelPrintItem,
  LabelPrintOptions,
} from '@/lib/pdf-labels';
import {
  Printer,
  Search,
  CheckSquare,
  Square,
  Eye,
  SlidersHorizontal,
  ArrowRight,
  X,
  FileText,
  Tag,
  ChevronDown,
  ChevronRight,
  Package,
  Download,
  CheckCircle2,
  Settings2,
} from 'lucide-react';

interface LabelsModuleProps {
  variants: (ProductVariant & { product: Product })[];
  currentRole: UserRole;
  onNavigateToScanner?: (barcode?: string) => void;
}

export function LabelsModule({
  variants,
  currentRole,
  onNavigateToScanner,
}: LabelsModuleProps) {
  // ── Estado da UI e Filtros ──
  const [searchTerm, setSearchTerm] = useState('');
  const [sizeFilter, setSizeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // ── Calibração da Mídia (Rolo Contínuo 2 Colunas) ──
  const [horizontalGapMm, setHorizontalGapMm] = useState(2);
  const [verticalGapMm, setVerticalGapMm] = useState(3);
  const [leftMarginMm, setLeftMarginMm] = useState(0);
  const [showCalibration, setShowCalibration] = useState(false);

  // ── Seleção em lote (armazena pares de etiquetas: 1 par = 2 etiquetas) ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiesMap, setCopiesMap] = useState<Record<string, number>>({});

  // ── Impressão individual ──
  const [singlePrintVariant, setSinglePrintVariant] = useState<
    (ProductVariant & { product: Product }) | null
  >(null);

  // ── Preview modal ──
  const [previewVariant, setPreviewVariant] = useState<
    (ProductVariant & { product: Product }) | null
  >(null);

  // ── Expansão de produtos na hierarquia ──
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  // ── Ref para saber se estamos imprimindo individualmente ──
  const isPrintingSingle = useRef(false);

  // ── Portal da área de impressão ──
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    setPortalReady(true);
  }, []);

  // ───────────────────────────────────────────
  // Filtros
  // ───────────────────────────────────────────
  const filteredVariants = variants.filter((v) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      !term ||
      v.product?.name.toLowerCase().includes(term) ||
      v.product?.sku.toLowerCase().includes(term) ||
      (v.barcode && v.barcode.includes(searchTerm)) ||
      v.color.toLowerCase().includes(term);

    const matchesSize = sizeFilter === 'ALL' || v.size === sizeFilter;
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && v.product?.active) ||
      (statusFilter === 'INACTIVE' && !v.product?.active);

    return matchesSearch && matchesSize && matchesStatus;
  });

  const availableSizes = Array.from(new Set(variants.map((v) => v.size))).sort();

  // ───────────────────────────────────────────
  // Agrupamento hierárquico: Produto → Variações
  // ───────────────────────────────────────────
  const productGroups = filteredVariants.reduce(
    (acc, v) => {
      const pid = v.product?.id ?? 'unknown';
      if (!acc[pid]) {
        acc[pid] = { product: v.product, variants: [] };
      }
      acc[pid].variants.push(v);
      return acc;
    },
    {} as Record<string, { product: Product; variants: (ProductVariant & { product: Product })[] }>
  );

  // ───────────────────────────────────────────
  // Seleção e desseleção em lote
  // ───────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    setSelectedIds(new Set(filteredVariants.map((v) => v.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const toggleProductExpand = useCallback((pid: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }, []);

  const expandAll = () => {
    setExpandedProducts(new Set(Object.keys(productGroups)));
  };

  const collapseAll = () => {
    setExpandedProducts(new Set());
  };

  const toggleGroupSelect = (groupVariants: (ProductVariant & { product: Product })[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = groupVariants.every((v) => next.has(v.id));
      groupVariants.forEach((v) => {
        if (allSelected) next.delete(v.id);
        else next.add(v.id);
      });
      return next;
    });
  };

  // ───────────────────────────────────────────
  // Controle de cópias de pares (cada cópia = 1 par de 2 etiquetas)
  // ───────────────────────────────────────────
  const handleCopiesChange = useCallback((id: string, delta: number) => {
    setCopiesMap((prev) => {
      const current = prev[id] || 1;
      const nextVal = Math.max(1, Math.min(100, current + delta));
      return { ...prev, [id]: nextVal };
    });
  }, []);

  // Opções de calibração para o gerador de PDF
  const printOptions: LabelPrintOptions = {
    labelWidthMm: 40,
    labelHeightMm: 30,
    horizontalGapMm,
    verticalGapMm,
    leftMarginMm,
  };

  // ───────────────────────────────────────────
  // Cálculos de pares e etiquetas
  // ───────────────────────────────────────────
  const selectedVariantsToPrint = variants.filter((v) => selectedIds.has(v.id));
  const totalPairsToPrint = selectedVariantsToPrint.reduce(
    (acc, v) => acc + (copiesMap[v.id] || 1),
    0
  );
  const totalLabelsCount = totalPairsToPrint * 2;

  // ───────────────────────────────────────────
  // Download do PDF Vetorial em Lote (82 × 30 mm)
  // ───────────────────────────────────────────
  const handleDownloadBatchPdf = () => {
    if (selectedVariantsToPrint.length === 0) return;

    const items: LabelPrintItem[] = selectedVariantsToPrint.map((v) => ({
      id: v.id,
      productName: v.product?.name || 'Produto',
      sku: v.product?.sku || '',
      color: v.color || '',
      size: v.size || '',
      barcode: v.barcode || '',
      pairsCount: copiesMap[v.id] || 1,
    }));

    downloadLabelsPdf(
      items,
      `etiquetas_mb_grupo_lote_${totalPairsToPrint}pares.pdf`,
      printOptions
    );
  };

  // ───────────────────────────────────────────
  // Download do PDF de um único par
  // ───────────────────────────────────────────
  const handleDownloadSinglePdf = (v: ProductVariant & { product: Product }) => {
    const pairsCount = copiesMap[v.id] || 1;
    const item: LabelPrintItem = {
      id: v.id,
      productName: v.product?.name || 'Produto',
      sku: v.product?.sku || '',
      color: v.color || '',
      size: v.size || '',
      barcode: v.barcode || '',
      pairsCount,
    };

    const safeSku = (v.barcode || v.product?.sku || 'etiqueta').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadLabelsPdf(
      [item],
      `etiqueta_${safeSku}_${pairsCount}pares.pdf`,
      printOptions
    );
  };

  // ───────────────────────────────────────────
  // Impressão via diálogo do navegador
  // ───────────────────────────────────────────
  const handlePrintBatch = () => {
    isPrintingSingle.current = false;
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const handlePrintSingle = useCallback((v: ProductVariant & { product: Product }) => {
    setSinglePrintVariant(v);
  }, []);

  useEffect(() => {
    if (!singlePrintVariant || typeof window === 'undefined') return;

    isPrintingSingle.current = true;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', finish);
      isPrintingSingle.current = false;
      setSinglePrintVariant(null);
    };
    window.addEventListener('afterprint', finish);

    const raf = requestAnimationFrame(() => {
      window.print();
      if (!('onafterprint' in window)) {
        setTimeout(finish, 1000);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', finish);
    };
  }, [singlePrintVariant]);

  return (
    <div className="space-y-6">
      {/* ── Banner Superior MB Grupo ── */}
      <div className="no-print flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              Rolo Contínuo 2 Colunas • LabelPrinter 4xx (200 DPI)
            </span>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">
            Central de Etiquetas de Códigos de Barras
          </h2>
          <p className="mt-1 text-xs text-slate-300">
            Impressão térmica exata de 2 etiquetas de 40 × 30 mm lado a lado (linha de 82 × 30 mm) com sensor de gap, escala 100% e vetor Code 128 nítido.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-center">
          {/* Botão Baixar PDF do Lote */}
          <button
            onClick={handleDownloadBatchPdf}
            disabled={totalPairsToPrint === 0}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all shadow-md ${
              totalPairsToPrint > 0
                ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer ring-2 ring-blue-400/30'
                : 'bg-white/10 text-white/40 cursor-not-allowed'
            }`}
            title="Gera e baixa o arquivo PDF com dimensões exatas de 82×30mm por par"
          >
            <Download className="h-4 w-4" />
            Baixar PDF ({totalPairsToPrint} {totalPairsToPrint === 1 ? 'par' : 'pares'} = {totalLabelsCount} un.)
          </button>

          {/* Botão Imprimir Térmica */}
          <button
            onClick={handlePrintBatch}
            disabled={totalPairsToPrint === 0}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all shadow-md ${
              totalPairsToPrint > 0
                ? 'bg-white text-slate-900 hover:bg-slate-100 cursor-pointer'
                : 'bg-white/20 text-white/50 cursor-not-allowed'
            }`}
          >
            <Printer className="h-4 w-4" />
            Imprimir Rolo Térmico
          </button>
        </div>
      </div>

      {/* ── Barra de Filtros e Calibração de Mídia ── */}
      <div className="no-print rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Busca */}
          <div className="relative sm:col-span-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, SKU, código de barras ou cor..."
              className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-hidden"
            />
          </div>

          {/* Filtro por Tamanho */}
          <div className="sm:col-span-3 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-slate-400 shrink-0" />
            <select
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 py-2 px-3 text-xs text-slate-700 focus:border-slate-900 focus:outline-hidden bg-white"
            >
              <option value="ALL">Todos os Tamanhos</option>
              {availableSizes.map((sz) => (
                <option key={sz} value={sz}>
                  Tamanho {sz}
                </option>
              ))}
            </select>
          </div>

          {/* Botão de Calibração da Mídia */}
          <div className="sm:col-span-3 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowCalibration(!showCalibration)}
              className={`w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                showCalibration
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
              }`}
            >
              <Settings2 className="h-4 w-4 text-slate-500" />
              <span>Ajustar Espaçamentos Físicos</span>
            </button>
          </div>
        </div>

        {/* Painel Retrátil de Calibração Físico da Mídia */}
        {showCalibration && (
          <div className="mt-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs animate-in fade-in duration-200">
            <div className="font-bold text-slate-800 flex items-center gap-1.5 mb-2">
              <Tag className="h-3.5 w-3.5 text-blue-600" />
              Calibração Físico da Mídia (Rolo 2 Colunas / 2 Carreiras)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Espaçamento Horizontal entre Etiquetas:
                </label>
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="10"
                    value={horizontalGapMm}
                    onChange={(e) => setHorizontalGapMm(Number(e.target.value) || 2)}
                    className="w-20 px-2 py-1 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                  />
                  <span className="text-slate-500">mm (Padrão: 2 mm)</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  X Esquerda = {leftMarginMm}mm | X Direita = {leftMarginMm + 40 + horizontalGapMm}mm
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Margem Lateral Esquerda do Liner:
                </label>
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="10"
                    value={leftMarginMm}
                    onChange={(e) => setLeftMarginMm(Number(e.target.value) || 0)}
                    className="w-20 px-2 py-1 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                  />
                  <span className="text-slate-500">mm (Padrão: 0 mm)</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Largura total do par: {leftMarginMm + 40 + horizontalGapMm + 40} mm
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Gap Vertical (Avanço do Sensor):
                </label>
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="10"
                    value={verticalGapMm}
                    onChange={(e) => setVerticalGapMm(Number(e.target.value) || 3)}
                    className="w-20 px-2 py-1 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                  />
                  <span className="text-slate-500">mm (Padrão: 3 mm)</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Altura da linha: 30 mm (Passo total: {30 + verticalGapMm} mm)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Ações de Seleção Rápida */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={selectAll}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              Selecionar Todas ({filteredVariants.length})
            </button>
            <span className="text-slate-300">•</span>
            <button
              onClick={deselectAll}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Desmarcar Todas
            </button>
            <span className="text-slate-300">•</span>
            <button
              onClick={expandAll}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              Expandir Todos ({Object.keys(productGroups).length} produtos)
            </button>
            <span className="text-slate-300">•</span>
            <button
              onClick={collapseAll}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Recolher Todos
            </button>
          </div>

          <span className="text-xs text-slate-600 font-semibold">
            {selectedIds.size} variações selecionadas ({totalPairsToPrint} pares = {totalLabelsCount} etiquetas)
          </span>
        </div>
      </div>

      {/* ── Grid Hierárquico: Produto → Variações ── */}
      <div className="no-print space-y-3">
        {Object.entries(productGroups).map(([pid, group]) => {
          const isExpanded = expandedProducts.has(pid);
          const groupSelectedCount = group.variants.filter((v) => selectedIds.has(v.id)).length;
          const groupAllSelected = groupSelectedCount === group.variants.length;

          return (
            <div
              key={pid}
              data-product-group={group.product?.sku}
              className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden"
            >
              {/* Cabeçalho do produto */}
              <div className="flex items-center">
                <button
                  onClick={() => toggleGroupSelect(group.variants)}
                  className="pl-5 pr-1 py-4 text-slate-400 hover:text-slate-900 transition-colors"
                  title={groupAllSelected ? 'Desmarcar todas' : 'Selecionar todas'}
                >
                  {groupAllSelected ? (
                    <CheckSquare className="h-5 w-5 text-slate-900" />
                  ) : (
                    <Square className="h-5 w-5" />
                  )}
                </button>
                <button
                  onClick={() => toggleProductExpand(pid)}
                  className="flex items-center justify-between w-full text-left px-4 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-slate-500" />
                    <div>
                      <span className="font-semibold text-slate-900">
                        {group.product?.name ?? 'Produto'}
                      </span>
                      <span className="ml-2 text-xs text-slate-500 font-mono">
                        SKU {group.product?.sku}
                      </span>
                    </div>
                    <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {group.variants.length} variações
                    </span>
                    {groupSelectedCount > 0 && (
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                        {groupSelectedCount} selecionadas
                      </span>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  )}
                </button>
              </div>

              {/* Variações expandidas */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.variants.map((v) => {
                      const isSelected = selectedIds.has(v.id);
                      const copies = copiesMap[v.id] || 1;

                      return (
                        <div
                          key={v.id}
                          data-variant-id={v.id}
                          className={`flex flex-col justify-between rounded-2xl border bg-white p-4 shadow-xs transition-all ${
                            isSelected
                              ? 'border-slate-900 ring-2 ring-slate-900/10'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {/* Cabeçalho */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="text-xs text-slate-500 mt-0.5">
                                Cor:{' '}
                                <span className="font-semibold text-slate-700">{v.color}</span>
                                {' • '}Tam:{' '}
                                <span className="font-bold text-slate-900">{v.size}</span>
                              </p>
                            </div>
                            <button
                              onClick={() => toggleSelect(v.id)}
                              className="p-1 rounded-md text-slate-400 hover:text-slate-900 transition-colors"
                              title={isSelected ? 'Desmarcar' : 'Selecionar para lote'}
                            >
                              {isSelected ? (
                                <CheckSquare className="h-5 w-5 text-slate-900" />
                              ) : (
                                <Square className="h-5 w-5" />
                              )}
                            </button>
                          </div>

                          {/* Miniatura do Código de Barras */}
                          <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col items-center">
                            <BarcodeLabelCard variant={v} />
                          </div>

                          {/* Controles de Pares e Ações */}
                          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-medium text-slate-500">Pares:</span>
                              <button
                                onClick={() => handleCopiesChange(v.id, -1)}
                                className="h-6 w-6 rounded bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 flex items-center justify-center text-xs"
                                title="Diminuir 1 par"
                              >
                                -
                              </button>
                              <span className="font-mono text-xs font-bold text-slate-900 px-1">
                                {copies}
                              </span>
                              <button
                                onClick={() => handleCopiesChange(v.id, 1)}
                                className="h-6 w-6 rounded bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 flex items-center justify-center text-xs"
                                title="Adicionar 1 par"
                              >
                                +
                              </button>
                              <span className="text-[10px] text-slate-400">({copies * 2} un.)</span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setPreviewVariant(v)}
                                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                title="Ver par de 82×30mm em tamanho real"
                              >
                                <Eye className="h-3 w-3 text-slate-500" />
                                Ver
                              </button>
                              <button
                                onClick={() => handleDownloadSinglePdf(v)}
                                className="flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-700 transition-colors"
                                title="Baixar PDF deste par para impressão"
                              >
                                <Download className="h-3 w-3" />
                                PDF
                              </button>
                              <button
                                onClick={() => handlePrintSingle(v)}
                                className="flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                                title="Imprime este par imediatamente no rolo térmico"
                              >
                                <Printer className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredVariants.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            Nenhuma variação encontrada para os filtros aplicados.
          </div>
        )}
      </div>

      {/* ── Modal de Pré-Visualização Física: Par de Etiquetas 82 × 30 mm ── */}
      {previewVariant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-indigo-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Pré-visualização da Linha de Impressão (Par 82 × 30 mm)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    2 etiquetas idênticas lado a lado • Rolo térmico LabelPrinter 4xx (200 DPI)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewVariant(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Simulação Física em Alta Resolução */}
            <div className="my-6 p-6 bg-slate-100 rounded-xl flex flex-col items-center justify-center">
              <div className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center gap-4">
                <span>Esquerda: X = 0 mm (40×30mm)</span>
                <span>•</span>
                <span className="text-blue-600 font-bold">Espaço = 2 mm</span>
                <span>•</span>
                <span>Direita: X = 42 mm (40×30mm)</span>
              </div>

              {/* O Par Físico Lado a Lado */}
              <div
                className="relative bg-white shadow-xl border border-slate-300 rounded-sm overflow-hidden"
                style={{ width: '82mm', height: '30mm' }}
              >
                {/* Etiqueta Esquerda */}
                <div className="absolute top-0 left-0" style={{ width: '40mm', height: '30mm' }}>
                  <SingleLabel40x30 variant={previewVariant} />
                </div>

                {/* Linha pontilhada no espaçamento central de 2mm para guia visual */}
                <div
                  className="absolute top-0 bottom-0 border-r border-dashed border-slate-300 pointer-events-none"
                  style={{ left: '41mm' }}
                />

                {/* Etiqueta Direita */}
                <div className="absolute top-0" style={{ left: '42mm', width: '40mm', height: '30mm' }}>
                  <SingleLabel40x30 variant={previewVariant} />
                </div>
              </div>

              <div className="mt-3 text-[10px] text-slate-400 font-mono text-center">
                Largura total da mídia: 82 mm • Altura da linha: 30 mm • Sensor de gap ativo
              </div>
            </div>

            {/* Ações do Modal */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100">
              {onNavigateToScanner && (
                <button
                  type="button"
                  onClick={() => {
                    const code = previewVariant.barcode;
                    setPreviewVariant(null);
                    onNavigateToScanner(code || undefined);
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  Testar este código na Bipagem USB
                </button>
              )}

              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setPreviewVariant(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Fechar
                </button>
                <button
                  onClick={() => handleDownloadSinglePdf(previewVariant)}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700"
                >
                  <Download className="h-4 w-4" />
                  Baixar PDF (82×30mm)
                </button>
                <button
                  onClick={() => handlePrintSingle(previewVariant)}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
                >
                  <Printer className="h-4 w-4" />
                  Imprimir no Rolo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          ÁREA EXCLUSIVA DE IMPRESSÃO TÉRMICA (@media print)
          Cada par de etiquetas gera exatamente 1 página física de 82×30mm.
          O sensor de gap do rolo avança automaticamente linha por linha.
          ══════════════════════════════════════════ */}
      {portalReady &&
        createPortal(
          <div className="print-only">
            {/* Impressão individual de 1 variante */}
            {singlePrintVariant && (
              <LabelPairRow82x30 variant={singlePrintVariant} />
            )}

            {/* Impressão em lote das variantes selecionadas */}
            {!singlePrintVariant &&
              selectedVariantsToPrint.map((v) => {
                const count = copiesMap[v.id] || 1;
                return Array.from({ length: count }).map((_, idx) => (
                  <LabelPairRow82x30
                    key={`${v.id}-pair-${idx}`}
                    variant={v}
                  />
                ));
              })}
          </div>,
          document.body
        )}
    </div>
  );
}
