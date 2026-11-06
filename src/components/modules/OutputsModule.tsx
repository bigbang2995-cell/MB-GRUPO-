'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ProductVariant, Product, UserRole, StockMovement, PendingExit } from '@/types/database';
export type { PendingExit };
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { resolveScannedBarcode } from '@/lib/barcode-service';
import {
  TrendingDown,
  Package,
  Plus,
  Minus,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Clock,
  Save,
  Trash2,
  Barcode,
  Search,
  Filter,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCw,
  ShoppingBag,
  ExternalLink,
  ShieldAlert,
  ClipboardCheck,
  X,
  Sparkles,
} from 'lucide-react';



interface OutputsModuleProps {
  variants: (ProductVariant & { product: Product })[];
  currentRole: UserRole;
  pendingExits: PendingExit[];
  onAddPendingExit: (exit: PendingExit) => void;
  onRemovePendingExit: (id: string) => void;
  onConsolidateExits: () => void;
  onConfirmExitBatch?: (exits: PendingExit[]) => void;
  movements?: StockMovement[];
}

const STORAGE_PENDING_EXITS = 'MB_GRUPO_PENDING_EXITS';

export function OutputsModule({
  variants,
  currentRole,
  pendingExits,
  onAddPendingExit,
  onRemovePendingExit,
  onConsolidateExits,
  onConfirmExitBatch,
  movements = [],
}: OutputsModuleProps) {
  // Estados de Busca e Navegação do Catálogo à Esquerda
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  // Estados do Painel de Bipagem de Saída à Direita
  const [scanMultiplier, setScanMultiplier] = useState<number>(1);
  const [manualBarcode, setManualBarcode] = useState('');
  const [channel, setChannel] = useState('SHOPEE');
  const [orderNumber, setOrderNumber] = useState('');
  const [exitReason, setExitReason] = useState('Separação de pedidos');

  // Input de quantidade personalizada por variante no catálogo
  const [customWithdrawQty, setCustomWithdrawQty] = useState<Record<string, string>>({});

  // Mensagens e Feedback
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
    details?: string;
  } | null>(null);

  // Modal de Conferência Unificada de Saída
  const [isConferenceOpen, setIsConferenceOpen] = useState(false);
  const [conferenceAdjustments, setConferenceAdjustments] = useState<Record<string, number>>({});
  const [conferenceJustifications, setConferenceJustifications] = useState<Record<string, string>>({});
  const [conferenceValidationError, setConferenceValidationError] = useState<string | null>(null);

  // Mapa de Produtos únicos
  const productsMap = new Map<string, Product>();
  variants.forEach((v) => {
    if (v.product && !productsMap.has(v.product.id)) {
      productsMap.set(v.product.id, v.product);
    }
  });
  const products = Array.from(productsMap.values());

  // Expande por padrão o primeiro produto se nenhum estiver expandido
  useEffect(() => {
    if (products.length > 0 && expandedProducts.size === 0) {
      setExpandedProducts(new Set([products[0].id]));
    }
  }, [products.length]);

  const toggleProductExpand = (productId: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // Feedback sonoro
  const playSound = (type: 'success' | 'error') => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtxClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch {}
  };

  // Calcula total pendente por variante
  const getPendingQuantityForVariant = (variantId: string) => {
    return pendingExits
      .filter((e) => e.variantId === variantId)
      .reduce((acc, it) => acc + it.quantity, 0);
  };

  // Verifica se o número de pedido já foi utilizado anteriormente (auditoria de duplicidade)
  const isDuplicateOrderNumber = Boolean(
    orderNumber.trim() &&
      movements.some(
        (m) =>
          m.order_number?.toLowerCase() === orderNumber.trim().toLowerCase() &&
          m.movement_type === 'exit'
      )
  );

  // Processa retirada manual pelo botão [-] ou quantidade personalizada
  const handleManualWithdraw = (variant: ProductVariant & { product?: Product }, qtyToWithdraw: number = 1) => {
    if (qtyToWithdraw <= 0) return;

    const alreadyPending = getPendingQuantityForVariant(variant.id);
    const availableStock = variant.stock_quantity - alreadyPending;

    if (qtyToWithdraw > availableStock) {
      playSound('error');
      setFeedbackBanner({
        type: 'error',
        message: `⛔ Saldo insuficiente: Você não pode retirar mais do que o saldo disponível.`,
        details: `Variação ${variant.color} (${variant.size}) possui ${availableStock} un. disponíveis para retirada, mas foram solicitadas ${qtyToWithdraw} un.`,
      });
      return;
    }

    const newExit: PendingExit = {
      id: `exit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      variantId: variant.id,
      sku: variant.product?.sku || '',
      productName: variant.product?.name || '',
      color: variant.color,
      size: variant.size,
      quantity: qtyToWithdraw,
      platform: channel,
      reason: exitReason,
      createdAt: new Date().toLocaleTimeString('pt-BR'),
      method: 'manual',
      orderNumber: orderNumber.trim() || undefined,
      barcode: variant.barcode || undefined,
      stockBefore: variant.stock_quantity,
    };

    onAddPendingExit(newExit);
    playSound('success');
    setFeedbackBanner({
      type: 'success',
      message: `Retirada Manual (-${qtyToWithdraw} un): ${variant.product?.name} (${variant.color} / ${variant.size})`,
      details: `Item adicionado às saídas pendentes de conferência. Saldo previsto: ${availableStock - qtyToWithdraw} un.`,
    });
  };

  // Processa leitura de código de barras (USB ou manual) no painel de saída
  const handleProcessScan = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    // Resolução centralizada com suporte a correspondência exata, case-insensitive e normalização ABNT2 (;)
    const resolution = resolveScannedBarcode(code, variants);

    if (!resolution.success || !resolution.matchedVariant) {
      playSound('error');
      setFeedbackBanner({
        type: 'error',
        message: `Código de barras não cadastrado: ${code}`,
        details: resolution.errorMessage || 'Este código não pertence a nenhuma peça do catálogo MB Grupo.',
      });
      setManualBarcode('');
      return;
    }

    const matchedVariant = resolution.matchedVariant;

    if (!matchedVariant.product?.active) {
      playSound('error');
      setFeedbackBanner({
        type: 'error',
        message: `⛔ Produto Desativado: ${matchedVariant.product?.name}`,
        details: 'Este modelo está inativo para movimentações operacionais no sistema.',
      });
      setManualBarcode('');
      return;
    }

    const qtyToWithdraw = Math.max(1, Math.floor(Number(scanMultiplier) || 1));
    const alreadyPending = getPendingQuantityForVariant(matchedVariant.id);
    const availableStock = matchedVariant.stock_quantity - alreadyPending;

    if (qtyToWithdraw > availableStock) {
      playSound('error');
      setFeedbackBanner({
        type: 'error',
        message: `⛔ Saldo insuficiente: Quantidade solicitada excede o saldo disponível.`,
        details: `Disponível: ${availableStock} un. | Solicitado no bipe: ${qtyToWithdraw} un. para ${matchedVariant.product?.name} (${matchedVariant.color} / ${matchedVariant.size}).`,
      });
      setManualBarcode('');
      return;
    }

    const newExit: PendingExit = {
      id: `exit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      variantId: matchedVariant.id,
      sku: matchedVariant.product?.sku || '',
      productName: matchedVariant.product?.name || '',
      color: matchedVariant.color,
      size: matchedVariant.size,
      quantity: qtyToWithdraw,
      platform: channel,
      reason: exitReason,
      createdAt: new Date().toLocaleTimeString('pt-BR'),
      method: 'scanner',
      orderNumber: orderNumber.trim() || undefined,
      barcode: matchedVariant.barcode || code,
      stockBefore: matchedVariant.stock_quantity,
    };

    onAddPendingExit(newExit);
    playSound('success');
    setFeedbackBanner({
      type: 'success',
      message: `Leitura Registrada (-${qtyToWithdraw} un): ${matchedVariant.product?.name} (${matchedVariant.color} / ${matchedVariant.size})`,
      details: `Canal: ${channel}${orderNumber ? ` • Pedido: ${orderNumber}` : ''}. Saldo previsto: ${availableStock - qtyToWithdraw} un.`,
    });

    setManualBarcode('');
    setScanMultiplier(1); // Retorna automaticamente para 1 após leitura válida
  };

  // Interceptor global do leitor USB quando a conferência não estiver aberta
  useBarcodeScanner({
    onScan: (scanned) => {
      if (!isConferenceOpen) {
        handleProcessScan(scanned);
      }
    },
    enabled: !isConferenceOpen,
  });

  // Filtra produtos à esquerda
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      variants.some(
        (v) =>
          v.product_id === p.id &&
          (v.color.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (v.barcode && v.barcode.includes(searchTerm)))
      );

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && p.active) ||
      (statusFilter === 'INACTIVE' && !p.active);

    return matchesSearch && matchesStatus;
  });

  // Totais
  const totalPendingUnits = pendingExits.reduce((acc, it) => acc + it.quantity, 0);

  // Consolidação por variante para a conferência unificada
  const consolidatedForConference = React.useMemo(() => {
    const map = new Map<
      string,
      {
        variantId: string;
        productName: string;
        sku: string;
        color: string;
        size: string;
        barcode: string;
        stockBefore: number;
        totalQuantity: number;
        hasManual: boolean;
        hasScanner: boolean;
        orderNumbers: Set<string>;
        platforms: Set<string>;
      }
    >();

    pendingExits.forEach((item) => {
      const existing = map.get(item.variantId);
      if (!existing) {
        const v = variants.find((vr) => vr.id === item.variantId);
        map.set(item.variantId, {
          variantId: item.variantId,
          productName: item.productName,
          sku: item.sku,
          color: item.color,
          size: item.size,
          barcode: item.barcode || v?.barcode || 'N/A',
          stockBefore: v?.stock_quantity ?? item.stockBefore ?? 0,
          totalQuantity: item.quantity,
          hasManual: item.method === 'manual',
          hasScanner: item.method === 'scanner',
          orderNumbers: new Set(item.orderNumber ? [item.orderNumber] : []),
          platforms: new Set([item.platform]),
        });
      } else {
        existing.totalQuantity += item.quantity;
        if (item.method === 'manual') existing.hasManual = true;
        if (item.method === 'scanner') existing.hasScanner = true;
        if (item.orderNumber) existing.orderNumbers.add(item.orderNumber);
        existing.platforms.add(item.platform);
      }
    });

    return Array.from(map.values());
  }, [pendingExits, variants]);

  // Abertura da Conferência Unificada
  const handleOpenConference = () => {
    if (pendingExits.length === 0) {
      alert('Nenhuma peça foi selecionada para saída ainda.');
      return;
    }
    const initAdj: Record<string, number> = {};
    const initJust: Record<string, string> = {};
    consolidatedForConference.forEach((c) => {
      initAdj[c.variantId] = c.totalQuantity;
      initJust[c.variantId] = '';
    });
    setConferenceAdjustments(initAdj);
    setConferenceJustifications(initJust);
    setConferenceValidationError(null);
    setIsConferenceOpen(true);
  };

  // Confirmação final da saída consolidada com auditoria
  const handleConfirmConferenceCommit = () => {
    setConferenceValidationError(null);

    // Valida se houve ajuste e exige justificativa obrigatória
    for (const c of consolidatedForConference) {
      const finalQty = conferenceAdjustments[c.variantId] ?? c.totalQuantity;
      const isAdjusted = finalQty !== c.totalQuantity;

      if (isAdjusted) {
        const just = conferenceJustifications[c.variantId] || '';
        if (just.trim().length < 4) {
          setConferenceValidationError(
            `Ajuste de quantidade detectado na variação "${c.productName} (${c.color} / ${c.size})". A justificativa é obrigatória (mínimo de 4 caracteres) para auditoria.`
          );
          playSound('error');
          return;
        }
      }

      if (finalQty > c.stockBefore) {
        setConferenceValidationError(
          `A quantidade final (${finalQty} un) para "${c.productName} (${c.color} / ${c.size})" excede o saldo físico em estoque (${c.stockBefore} un).`
        );
        playSound('error');
        return;
      }
    }

    // Se tudo válido, constrói lista ajustada de saídas
    const finalExitsToCommit: PendingExit[] = [];
    consolidatedForConference.forEach((c) => {
      const finalQty = conferenceAdjustments[c.variantId] ?? c.totalQuantity;
      if (finalQty > 0) {
        finalExitsToCommit.push({
          id: `exit-commit-${Date.now()}-${c.variantId}`,
          variantId: c.variantId,
          sku: c.sku,
          productName: c.productName,
          color: c.color,
          size: c.size,
          quantity: finalQty,
          platform: Array.from(c.platforms).join(', ') || channel,
          reason: exitReason,
          createdAt: new Date().toLocaleTimeString('pt-BR'),
          method: c.hasManual && c.hasScanner ? 'mixed' : c.hasManual ? 'manual' : 'scanner',
          orderNumber: Array.from(c.orderNumbers).join(', ') || undefined,
          barcode: c.barcode,
          stockBefore: c.stockBefore,
          justification: conferenceJustifications[c.variantId] || undefined,
        });
      }
    });

    if (onConfirmExitBatch) {
      onConfirmExitBatch(finalExitsToCommit);
    } else {
      onConsolidateExits();
    }

    playSound('success');
    setIsConferenceOpen(false);
    const totalCommitted = finalExitsToCommit.reduce((a, b) => a + b.quantity, 0);
    setFeedbackBanner({
      type: 'success',
      message: `Saída de ${totalCommitted} peças confirmada e baixada do estoque oficial com sucesso!`,
      details: 'Movimentações registradas no histórico com rastreabilidade completa por método e canal.',
    });
  };

  return (
    <div className="space-y-6 pb-12">
      {/* CABEÇALHO DA PÁGINA REGISTRAR SAÍDAS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Registrar Saídas de Estoque
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-800 border border-rose-200">
              <TrendingDown className="h-3.5 w-3.5 text-rose-600" /> Baixa por Pedido & Marketplaces
            </span>
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
              {totalPendingUnits} {totalPendingUnits === 1 ? 'peça pendente' : 'peças pendentes'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Selecione peças do catálogo pelo botão <strong>[−]</strong> ou aponte o leitor USB no painel à direita para registrar baixas com conferência.
          </p>
        </div>
      </div>

      {/* BANNER DE FEEDBACK VISUAL EM TEMPO REAL */}
      {feedbackBanner && (
        <div
          data-feedback-banner="true"
          className={`p-4 rounded-2xl border text-xs flex items-start justify-between gap-3 shadow-xs animate-in fade-in ${
            feedbackBanner.type === 'error'
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : feedbackBanner.type === 'warning'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <div className="shrink-0 mt-0.5">
              {feedbackBanner.type === 'error' ? (
                <AlertCircle className="h-4 w-4 text-rose-600" />
              ) : feedbackBanner.type === 'warning' ? (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle className="h-4 w-4 text-emerald-600" />
              )}
            </div>
            <div>
              <p className="font-bold">{feedbackBanner.message}</p>
              {feedbackBanner.details && (
                <p className="mt-0.5 text-[11px] opacity-90">{feedbackBanner.details}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => setFeedbackBanner(null)}
            className="text-slate-400 hover:text-slate-600 text-xs font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* LAYOUT PRINCIPAL EM DUAS ÁREAS: ESQUERDA (CATÁLOGO) & DIREITA (PAINEL DE SAÍDA) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ========================================================= */}
        {/* LADO ESQUERDO — CATÁLOGO DE PRODUTOS COM RETIRADA MANUAL [−] */}
        {/* ========================================================= */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Catálogo de Produtos & Variações
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">
                Clique na foto ou nome para expandir cores e tamanhos
              </span>
            </div>

            {/* Barra de Filtros */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar produto, SKU, cor ou código..."
                  className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400 shrink-0" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-300 py-2 px-3 text-xs text-slate-700 focus:border-slate-900 focus:outline-hidden bg-white"
                >
                  <option value="ALL">Todos os Produtos</option>
                  <option value="ACTIVE">Apenas Modelos Ativos</option>
                  <option value="INACTIVE">Apenas Desativados</option>
                </select>
              </div>
            </div>
          </div>

          {/* Lista Vertical de Produtos */}
          <div className="space-y-3">
            {filteredProducts.map((p) => {
              const prodVariants = variants.filter((v) => v.product_id === p.id);
              const totalOfficialStock = prodVariants.reduce((a, b) => a + b.stock_quantity, 0);
              const totalPendingForThisProd = prodVariants.reduce(
                (a, b) => a + getPendingQuantityForVariant(b.id),
                0
              );
              const availableStock = Math.max(0, totalOfficialStock - totalPendingForThisProd);
              const isExpanded = expandedProducts.has(p.id);

              return (
                <div
                  key={p.id}
                  data-product-sku={p.sku}
                  className={`rounded-2xl border bg-white transition-all overflow-hidden ${
                    isExpanded
                      ? 'border-slate-300 shadow-md ring-1 ring-slate-200'
                      : 'border-slate-200 shadow-2xs hover:border-slate-300'
                  }`}
                >
                  {/* Cabeçalho do Card do Produto (Clicável para expandir) */}
                  <div
                    onClick={() => toggleProductExpand(p.id)}
                    className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-slate-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {/* Foto / Ícone MB */}
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 border border-slate-200 overflow-hidden shadow-2xs">
                        {p.image_path ? (
                          <img src={p.image_path} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="font-black text-slate-700 text-sm">MB</span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                            {p.sku}
                          </span>
                          {p.active ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                              Ativo
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                              Desativado
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-bold text-slate-900 mt-1 truncate">
                          {p.name}
                        </h4>

                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {prodVariants.length} variações (Cores e Tamanhos)
                        </p>
                      </div>
                    </div>

                    {/* Resumo de Estoque e Indicador de Expansão */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">
                          Disponível
                        </span>
                        <span className="text-sm font-black font-mono text-slate-900">
                          {availableStock} un
                        </span>
                        {totalPendingForThisProd > 0 && (
                          <span className="text-[10px] font-bold text-rose-600 block">
                            (-{totalPendingForThisProd} pend.)
                          </span>
                        )}
                      </div>

                      <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                  </div>

                  {/* Variações Expandidas do Produto (Cores, Estampas e Tamanhos) */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-4 animate-in fade-in duration-150">
                      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                        <div className="bg-slate-100/70 px-4 py-2 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold uppercase text-slate-600">
                          <span>Variação</span>
                          <div className="flex items-center gap-6">
                            <span>Saldo Atual</span>
                            <span>Saída Pend.</span>
                            <span>Previsto</span>
                            <span className="w-40 text-center">Ação Manual</span>
                          </div>
                        </div>

                        <div className="divide-y divide-slate-100">
                          {prodVariants.map((v) => {
                            const pendingForV = getPendingQuantityForVariant(v.id);
                            const availableForV = Math.max(0, v.stock_quantity - pendingForV);
                            const projectedForV = Math.max(0, v.stock_quantity - pendingForV);
                            const isOutOfStock = availableForV <= 0;

                            return (
                              <div
                                key={v.id}
                                className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors text-xs"
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-900">{v.color}</span>
                                    <span className="border border-slate-300 px-1.5 py-0.5 rounded font-mono font-bold text-[10px] text-slate-800">
                                      {v.size}
                                    </span>
                                  </div>
                                  <span className="font-mono text-[10px] text-slate-400 mt-0.5 block">
                                    {v.barcode || 'Sem código'}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-5">
                                  {/* Saldo Oficial */}
                                  <div className="text-right">
                                    <span className="font-mono font-semibold text-slate-700">
                                      {v.stock_quantity} un
                                    </span>
                                  </div>

                                  {/* Saída Pendente */}
                                  <div className="text-center w-16">
                                    {pendingForV > 0 ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-mono font-extrabold text-xs border border-rose-200">
                                        -{pendingForV} un
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 font-mono text-xs">0</span>
                                    )}
                                  </div>

                                  {/* Saldo Previsto */}
                                  <div className="text-right w-16">
                                    <span
                                      className={`font-mono font-black text-xs ${
                                        pendingForV > 0 ? 'text-rose-600' : 'text-slate-900'
                                      }`}
                                    >
                                      {projectedForV} un
                                    </span>
                                  </div>

                                  {/* Controles de Retirada Manual [−] */}
                                  <div className="flex items-center gap-1.5 w-40 justify-end">
                                    {/* Botão [−] (-1 unidade) */}
                                    <button
                                      type="button"
                                      data-testid={`btn-minus-${v.id}`}
                                      disabled={isOutOfStock}
                                      onClick={() => handleManualWithdraw(v, 1)}
                                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold text-xs shadow-2xs transition-colors ${
                                        isOutOfStock
                                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                          : 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer'
                                      }`}
                                      title={
                                        isOutOfStock
                                          ? 'Saldo disponível esgotado'
                                          : 'Retirar 1 peça manualmente'
                                      }
                                    >
                                      <Minus className="h-3.5 w-3.5" />
                                      <span>-1</span>
                                    </button>

                                    {/* Input de Quantidade Personalizada */}
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min={1}
                                        max={availableForV}
                                        placeholder="Qtd"
                                        disabled={isOutOfStock}
                                        value={customWithdrawQty[v.id] || ''}
                                        onChange={(e) =>
                                          setCustomWithdrawQty((prev) => ({
                                            ...prev,
                                            [v.id]: e.target.value,
                                          }))
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const val = parseInt(customWithdrawQty[v.id] || '0', 10);
                                            if (val > 0) {
                                              handleManualWithdraw(v, val);
                                              setCustomWithdrawQty((prev) => ({ ...prev, [v.id]: '' }));
                                            }
                                          }
                                        }}
                                        className="w-14 rounded-lg border border-slate-300 py-1 px-1 text-center text-xs font-mono font-bold text-slate-800 focus:border-rose-600 focus:outline-hidden bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
                                      />
                                      <button
                                        type="button"
                                        disabled={isOutOfStock}
                                        onClick={() => {
                                          const val = parseInt(customWithdrawQty[v.id] || '0', 10);
                                          if (val > 0) {
                                            handleManualWithdraw(v, val);
                                            setCustomWithdrawQty((prev) => ({ ...prev, [v.id]: '' }));
                                          }
                                        }}
                                        className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700 transition-colors disabled:opacity-40"
                                        title="Retirar quantidade personalizada digitada"
                                      >
                                        -
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ========================================================= */}
        {/* LADO DIREITO — PAINEL DE BIPAGEM DE SAÍDA OFICIAL */}
        {/* ========================================================= */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            {/* Topo do Painel de Bipagem */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Barcode className="h-5 w-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Painel de Bipagem de Saída
                </h3>
              </div>

              {/* Indicador do Leitor USB */}
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Leitor USB Ativo
              </span>
            </div>

            {/* Configuração do Destino e Pedido */}
            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Canal / Destino da Saída:
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'SHOPEE', label: 'Shopee' },
                    { id: 'TIKTOK_SHOP', label: 'TikTok Shop' },
                    { id: 'SHEIN', label: 'SHEIN' },
                    { id: 'AVARIA', label: 'Avaria' },
                    { id: 'SAIDA_INTERNA', label: 'Saída Interna' },
                  ].map((dest) => (
                    <button
                      key={dest.id}
                      type="button"
                      onClick={() => setChannel(dest.id)}
                      className={`px-2 py-1.5 rounded-lg font-bold text-[11px] border transition-all text-center ${
                        channel === dest.id
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {dest.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Número do Pedido e Verificação de Duplicidade */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">
                    Número / Identificador do Pedido:
                  </label>
                  {isDuplicateOrderNumber && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Pedido já registrado
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="Ex: SHP-984201, TK-44129..."
                  className={`w-full rounded-xl border p-2.5 text-xs font-mono font-medium focus:outline-hidden ${
                    isDuplicateOrderNumber
                      ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-600'
                      : 'border-slate-300 bg-slate-50 text-slate-900 focus:border-slate-900'
                  }`}
                />
              </div>

              {/* Multiplicador: Quantidade por Leitura */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                    Quantidade por Leitura:
                  </label>
                  <span className="text-[10px] text-slate-500">
                    Retorna para 1 após o bipe
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={scanMultiplier}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setScanMultiplier(isNaN(val) || val <= 0 ? 1 : val);
                    }}
                    onKeyDown={(e) => {
                      // Impede que rajada do leitor ou Enter altere este campo acidentalmente
                      if (e.key === 'Enter') {
                        e.preventDefault();
                      }
                    }}
                    className="w-20 rounded-lg border border-slate-300 py-1.5 px-2 text-center text-sm font-black font-mono text-slate-900 focus:border-indigo-600 focus:outline-hidden bg-white shadow-2xs"
                  />

                  {/* Chips Rápidos de Multiplicador */}
                  <div className="flex items-center gap-1 flex-1">
                    {[1, 5, 10, 25, 30, 100].map((quick) => (
                      <button
                        key={quick}
                        type="button"
                        onClick={() => setScanMultiplier(quick)}
                        className={`flex-1 py-1 rounded text-[11px] font-bold border transition-colors ${
                          scanMultiplier === quick
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {quick}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Formulário de Bipagem de Código de Barras */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Código de Barras da Peça:
                </label>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleProcessScan(manualBarcode);
                  }}
                  className="flex gap-2"
                >
                  <div className="relative flex-1">
                    <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      data-outputs-barcode-input="true"
                      type="text"
                      value={manualBarcode}
                      onChange={(e) => setManualBarcode(e.target.value)}
                      placeholder="Aponte o leitor USB ou digite..."
                      className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-xs font-mono text-slate-900 focus:border-slate-900 focus:outline-hidden bg-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 font-bold text-xs transition-colors shrink-0 cursor-pointer"
                  >
                    Bipar {scanMultiplier > 1 ? `(-${scanMultiplier})` : '(-1)'}
                  </button>
                </form>
              </div>
            </div>

            {/* Resumo da Sessão e Botão Conferir Saída */}
            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Total Pendente
                </span>
                <span className="text-xl font-black font-mono text-rose-600">
                  {totalPendingUnits} un
                </span>
              </div>

              <button
                type="button"
                onClick={handleOpenConference}
                disabled={pendingExits.length === 0}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-all shadow-xs ${
                  pendingExits.length === 0
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white hover:scale-[1.02] cursor-pointer'
                }`}
              >
                <ClipboardCheck className="h-4 w-4" />
                Conferir Saída ({totalPendingUnits} un)
              </button>
            </div>
          </div>

          {/* Lista de Peças Selecionadas Desta Sessão */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                Peças Selecionadas para Baixa ({pendingExits.length} registros)
              </span>
              {pendingExits.length > 0 && (
                <span className="text-[10px] text-slate-400">
                  Diferentes produtos permitidos
                </span>
              )}
            </div>

            {pendingExits.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                Nenhuma peça adicionada à saída ainda.
                <br />
                Utilize o botão <strong>[−]</strong> no catálogo ou aponte o leitor USB.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 mt-2 text-xs">
                {pendingExits.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 truncate">
                          {item.productName}
                        </span>
                        <span className="border border-slate-200 px-1.5 py-0.2 rounded font-mono text-[10px] text-slate-600">
                          {item.color} / {item.size}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            item.method === 'scanner'
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {item.method === 'scanner' ? 'Bipagem' : 'Manual'}
                        </span>
                        <span>Canal: {item.platform}</span>
                        {item.orderNumber && (
                          <span className="font-mono text-slate-600">
                            Ped: {item.orderNumber}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono font-black text-rose-600 text-sm">
                        -{item.quantity} un
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemovePendingExit(item.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 transition-colors"
                        title="Remover este item da saída"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL DE CONFERÊNCIA UNIFICADA DE SAÍDA */}
      {/* ========================================================= */}
      {isConferenceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto animate-in fade-in">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
            {/* Topo do Modal */}
            <div className="bg-slate-900 text-white p-4 sm:p-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 font-extrabold text-white shadow-xs">
                  <TrendingDown className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold tracking-tight text-white">
                    Conferência Unificada de Saída de Estoque
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Revise as peças bipadas e manuais antes de registrar a baixa definitiva no estoque oficial.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsConferenceOpen(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Erro de Validação de Justificativa */}
            {conferenceValidationError && (
              <div className="bg-rose-100 border-b border-rose-200 px-4 py-2.5 text-xs text-rose-800 font-bold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                  {conferenceValidationError}
                </span>
                <button
                  onClick={() => setConferenceValidationError(null)}
                  className="text-rose-600 hover:text-rose-800 font-black text-sm"
                >
                  ×
                </button>
              </div>
            )}

            {/* Conteúdo da Tabela de Conferência */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-bold">Produto / Variação</th>
                      <th className="py-3 px-4 font-bold text-center">Método</th>
                      <th className="py-3 px-4 font-bold text-center">Saldo Atual</th>
                      <th className="py-3 px-4 font-bold text-center">Qtd Baixa</th>
                      <th className="py-3 px-4 font-bold">Justificativa (Se corrigido)</th>
                      <th className="py-3 px-4 font-bold text-right">Saldo Previsto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {consolidatedForConference.map((item) => {
                      const finalQty = conferenceAdjustments[item.variantId] ?? item.totalQuantity;
                      const isAdjusted = finalQty !== item.totalQuantity;
                      const projectedStock = item.stockBefore - finalQty;
                      const hasMissingJust =
                        isAdjusted &&
                        (!conferenceJustifications[item.variantId] ||
                          conferenceJustifications[item.variantId].trim().length < 4);

                      return (
                        <tr
                          key={item.variantId}
                          className={`hover:bg-slate-50/70 transition-colors ${
                            hasMissingJust ? 'bg-rose-50/40' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-bold text-slate-900">
                            <div>{item.productName}</div>
                            <div className="text-[11px] font-normal text-slate-500">
                              {item.color} • Tam {item.size} • SKU {item.sku}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-center">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                item.hasManual && item.hasScanner
                                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                  : item.hasManual
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              }`}
                            >
                              {item.hasManual && item.hasScanner
                                ? 'Misto'
                                : item.hasManual
                                ? 'Manual'
                                : 'Bipagem'}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-center font-mono font-semibold text-slate-700">
                            {item.stockBefore} un
                          </td>

                          {/* Quantidade a Baixar com ajuste */}
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setConferenceAdjustments((prev) => ({
                                    ...prev,
                                    [item.variantId]: Math.max(0, finalQty - 1),
                                  }))
                                }
                                className="h-6 w-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={item.stockBefore}
                                value={finalQty}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  setConferenceAdjustments((prev) => ({
                                    ...prev,
                                    [item.variantId]: isNaN(val) || val < 0 ? 0 : val,
                                  }));
                                }}
                                className={`w-14 rounded-lg border py-1 px-1.5 text-center font-mono font-bold text-xs ${
                                  isAdjusted
                                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                                    : 'border-slate-300 text-slate-900'
                                }`}
                              />
                              <button
                                type="button"
                                data-testid="conf-plus-btn"
                                onClick={() =>
                                  setConferenceAdjustments((prev) => ({
                                    ...prev,
                                    [item.variantId]: Math.min(item.stockBefore, finalQty + 1),
                                  }))
                                }
                                className="h-6 w-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                              >
                                +
                              </button>
                            </div>
                          </td>

                          {/* Justificativa Obrigatória se Ajustado */}
                          <td className="py-3 px-4">
                            {isAdjusted ? (
                              <input
                                type="text"
                                data-testid="conf-just-input"
                                placeholder="Motivo obrigatório (mín. 4 letras)..."
                                value={conferenceJustifications[item.variantId] || ''}
                                onChange={(e) =>
                                  setConferenceJustifications((prev) => ({
                                    ...prev,
                                    [item.variantId]: e.target.value,
                                  }))
                                }
                                className={`w-full rounded-lg border py-1 px-2 text-xs focus:outline-hidden ${
                                  hasMissingJust
                                    ? 'border-rose-300 bg-rose-50 text-rose-900 focus:border-rose-500'
                                    : 'border-slate-300 text-slate-800 focus:border-slate-900'
                                }`}
                              />
                            ) : (
                              <span className="text-slate-400 text-[11px] italic">Sem alteração</span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right font-mono font-black text-slate-900 text-xs">
                            {projectedStock} un
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Resumo da Baixa */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-bold text-slate-900">Total a baixar nesta operação:</span>
                  <p className="text-slate-500 mt-0.5">
                    As quantidades serão subtraídas atomicamente do saldo oficial de cada variação.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black font-mono text-rose-600">
                    -
                    {Object.values(conferenceAdjustments).reduce((a, b) => a + b, 0)}{' '}
                    un
                  </span>
                </div>
              </div>
            </div>

            {/* Rodapé do Modal */}
            <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsConferenceOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Voltar à Edição
              </button>

              <button
                type="button"
                data-testid="conf-commit-btn"
                onClick={handleConfirmConferenceCommit}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 text-xs font-bold transition-all shadow-md hover:scale-[1.02] cursor-pointer"
              >
                <Save className="h-4 w-4" />
                Confirmar Baixa de Estoque
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
