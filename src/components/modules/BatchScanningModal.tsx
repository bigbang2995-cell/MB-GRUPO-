'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Product,
  ProductVariant,
  BatchScanningSession,
  BatchCommitResult,
  UserRole,
} from '@/types/database';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { BarcodeRenderer } from '@/components/common/BarcodeRenderer';
import { resolveScannedBarcode } from '@/lib/barcode-service';
import {
  Barcode,
  Play,
  Pause,
  ClipboardCheck,
  Save,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Info,
  Clock,
  RotateCw,
  Tag,
  Volume2,
  VolumeX,
  Printer,
  ChevronRight,
  Layers,
} from 'lucide-react';

interface BatchScanningModalProps {
  product: Product;
  allVariants: (ProductVariant & { product: Product })[];
  currentRole: UserRole;
  initialSession?: BatchScanningSession | null;
  onClose: () => void;
  onCommitBatch: (
    session: BatchScanningSession,
    forcedIdempotencyKey?: string
  ) => BatchCommitResult;
  onDiscardSession: () => void;
  onNavigateToLabels?: () => void;
}

const STORAGE_KEY = 'MB_GRUPO_BATCH_SESSION';

function generateSecureUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function BatchScanningModal({
  product,
  allVariants,
  currentRole,
  initialSession,
  onClose,
  onCommitBatch,
  onDiscardSession,
  onNavigateToLabels,
}: BatchScanningModalProps) {
  // Filtra as variantes específicas deste produto
  const productVariants = allVariants.filter((v) => v.product_id === product.id);

  // Inicializa ou recupera a sessão do lote
  const [session, setSession] = useState<BatchScanningSession>(() => {
    if (initialSession && initialSession.product_id === product.id) {
      return initialSession;
    }

    const itemsMap: BatchScanningSession['items'] = {};
    productVariants.forEach((v) => {
      itemsMap[v.id] = {
        variant_id: v.id,
        barcode: v.barcode || '',
        color: v.color,
        size: v.size,
        scanned_quantity: 0,
        manual_adjustment: 0,
        final_quantity: 0,
        stock_before: v.stock_quantity,
        justification: '',
      };
    });

    return {
      id: generateSecureUUID(),
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      product_image_path: product.image_path,
      status: 'active',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: currentRole === 'admin' ? 'usr-1' : 'usr-2',
      operator_name:
        currentRole === 'admin' ? 'Bianca (Supervisora)' : 'Carlos (Operador de Bipagem)',
      items: itemsMap,
      scan_events: [],
    };
  });

  const [activeTab, setActiveTab] = useState<'scan' | 'review'>('scan');
  const [manualCode, setManualCode] = useState('');
  const [scanMultiplier, setScanMultiplier] = useState<number>(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [alertBanner, setAlertBanner] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
    details?: string;
  } | null>(null);

  const [commitResult, setCommitResult] = useState<BatchCommitResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Salva no localStorage a cada alteração da sessão
  useEffect(() => {
    if (session.status !== 'committed') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch {}
    }
  }, [session]);

  // Audio feedback
  const playSound = (type: 'success' | 'error' | 'replay') => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1100, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'replay') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(750, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch {}
  };

  /**
   * Processa uma leitura de código de barras durante a sessão de lote
   */
  const handleProcessScan = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    if (session.status !== 'active') {
      setAlertBanner({
        type: 'warning',
        message: 'A bipagem está pausada.',
        details: 'Clique em "Retomar Bipagem" para continuar bipando este lote.',
      });
      playSound('error');
      return;
    }

    // 1. Resolução centralizada com suporte a correspondência exata, case-insensitive e normalização ABNT2 (;)
    const resolution = resolveScannedBarcode(code, allVariants);

    if (!resolution.success || !resolution.matchedVariant) {
      playSound('error');
      setAlertBanner({
        type: 'error',
        message: `Código de barras não cadastrado: ${code}`,
        details: resolution.errorMessage || 'Este código não pertence a nenhum produto ou variação do catálogo MB Grupo.',
      });
      setManualCode('');
      return;
    }

    const matchedVariantInCatalog = resolution.matchedVariant;

    // 2. REGRA DE SEGURANÇA: O código pertence a OUTRO PRODUTO?
    if (matchedVariantInCatalog.product_id !== product.id) {
      playSound('error');
      const otherProduct = matchedVariantInCatalog.product;
      setAlertBanner({
        type: 'error',
        message: `⛔ Código Rejeitado: O código pertence a outro produto!`,
        details: `Código ${code} é da peça "${otherProduct?.name}" (SKU: ${otherProduct?.sku}). O lote atual em andamento é restrito ao produto "${product.name}".`,
      });
      setManualCode('');
      return;
    }

    // 3. O código pertence a uma variação válida deste produto!
    playSound('success');
    const variantId = matchedVariantInCatalog.id;
    const addQty = Math.max(1, Math.floor(Number(scanMultiplier) || 1));

    setSession((prev) => {
      const existingItem = prev.items[variantId] || {
        variant_id: variantId,
        barcode: code,
        color: matchedVariantInCatalog.color,
        size: matchedVariantInCatalog.size,
        scanned_quantity: 0,
        manual_adjustment: 0,
        final_quantity: 0,
        stock_before: matchedVariantInCatalog.stock_quantity,
        justification: '',
      };

      const newScanned = existingItem.scanned_quantity + addQty;
      const newFinal = newScanned + existingItem.manual_adjustment;

      const updatedItem = {
        ...existingItem,
        scanned_quantity: newScanned,
        final_quantity: newFinal,
        method: (existingItem.manual_adjustment !== 0 ? 'mixed' : 'scanner') as 'scanner' | 'manual' | 'mixed',
      };

      const newEvent = {
        id: generateSecureUUID(),
        barcode: code,
        variant_id: variantId,
        product_id: product.id,
        product_name: product.name,
        color: matchedVariantInCatalog.color,
        size: matchedVariantInCatalog.size,
        timestamp: `${new Date().toLocaleTimeString('pt-BR')} (+${addQty})`,
      };

      return {
        ...prev,
        updated_at: new Date().toISOString(),
        items: {
          ...prev.items,
          [variantId]: updatedItem,
        },
        scan_events: [newEvent, ...prev.scan_events.slice(0, 49)],
      };
    });

    setAlertBanner({
      type: 'success',
      message: `Peça Registrada no Lote (+${addQty}): ${matchedVariantInCatalog.color} • Tam ${matchedVariantInCatalog.size}`,
      details: `Contador temporário: ${(session.items[variantId]?.scanned_quantity || 0) + addQty} peças contadas deste modelo. (Saldo oficial ainda não alterado)`,
    });
    setManualCode('');
    setScanMultiplier(1);
  };

  // Interceptor de teclado HID do Leitor USB quando a sessão estiver ativa
  useBarcodeScanner({
    onScan: (scanned) => {
      if (session.status === 'active' && activeTab === 'scan' && !commitResult) {
        handleProcessScan(scanned);
      }
    },
    enabled: session.status === 'active' && activeTab === 'scan' && !commitResult,
  });

  // Totais contados no lote
  const totalScanned = Object.values(session.items).reduce(
    (acc, it) => acc + (it.scanned_quantity || 0),
    0
  );
  const totalFinal = Object.values(session.items).reduce(
    (acc, it) => acc + (it.final_quantity || 0),
    0
  );

  // Alteração de status da sessão
  const handleTogglePause = () => {
    const nextStatus = session.status === 'active' ? 'paused' : 'active';
    setSession((prev) => ({ ...prev, status: nextStatus }));
    setAlertBanner({
      type: nextStatus === 'paused' ? 'warning' : 'success',
      message:
        nextStatus === 'paused'
          ? 'Sessão de bipagem pausada.'
          : 'Sessão de bipagem retomada! Leitor USB ativo.',
    });
  };

  // Atualização manual na conferência
  const handleManualQuantityChange = (variantId: string, valStr: string) => {
    const num = parseInt(valStr, 10);
    const newFinal = isNaN(num) || num < 0 ? 0 : num;

    setSession((prev) => {
      const it = prev.items[variantId];
      if (!it) return prev;
      const adjustment = newFinal - it.scanned_quantity;
      return {
        ...prev,
        items: {
          ...prev.items,
          [variantId]: {
            ...it,
            final_quantity: newFinal,
            manual_adjustment: adjustment,
          },
        },
      };
    });
  };

  const handleJustificationChange = (variantId: string, text: string) => {
    setSession((prev) => {
      const it = prev.items[variantId];
      if (!it) return prev;
      return {
        ...prev,
        items: {
          ...prev.items,
          [variantId]: {
            ...it,
            justification: text,
          },
        },
      };
    });
  };

  // Validação e confirmação atômica do lote
  const handleCommitFinal = (forcedIdempotencyKey?: string) => {
    setValidationError(null);

    // Validação obrigatória: Se houve ajuste manual, a justificativa não pode ser vazia
    for (const item of Object.values(session.items)) {
      if (item.manual_adjustment !== 0) {
        if (!item.justification || item.justification.trim().length < 4) {
          setValidationError(
            `Ajuste manual detectado na variação "${item.color} • Tam ${item.size}". A justificativa é obrigatória (mínimo de 4 caracteres) para auditoria.`
          );
          setActiveTab('review');
          playSound('error');
          return;
        }
      }
    }

    if (totalFinal === 0 && !forcedIdempotencyKey) {
      setValidationError('Nenhuma peça foi contada neste lote.');
      playSound('error');
      return;
    }

    // Executa a confirmação atômica
    const result = onCommitBatch(session, forcedIdempotencyKey);
    setCommitResult(result);

    if (result.success) {
      if (result.idempotent_replay) {
        playSound('replay');
      } else {
        playSound('success');
      }
      setSession((prev) => ({ ...prev, status: 'committed' }));
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    } else {
      playSound('error');
      setValidationError(result.message);
    }
  };

  // Reenvio da mesma operação usando a mesma chave UUID para validação de idempotência
  const handleRetryIdempotentBatch = () => {
    if (!commitResult) return;
    handleCommitFinal(commitResult.batch_idempotency_key);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Top Header do Lote */}
        <div className="bg-slate-900 text-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 font-extrabold text-white shadow-xs">
              V30
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-indigo-300 uppercase">
                  Lote Exclusivo • {product.sku}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    session.status === 'active'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : session.status === 'paused'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  }`}
                >
                  {session.status === 'active'
                    ? '● Bipagem Ativa'
                    : session.status === 'paused'
                    ? '⏸ Pausada'
                    : '✓ Lote Concluído'}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-white mt-0.5">
                {product.name}
              </h2>
            </div>
          </div>

          {/* Controles de Lote e Contadores */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-white/10 rounded-xl px-3 py-1.5 border border-white/10 text-right">
              <span className="text-[10px] uppercase tracking-wider text-slate-300 block">
                Total Contado
              </span>
              <span className="text-lg font-black text-white font-mono leading-none">
                {totalFinal} un
              </span>
            </div>

            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors border border-white/10"
              title="Alternar som"
            >
              {soundEnabled ? (
                <Volume2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <VolumeX className="h-4 w-4 text-slate-400" />
              )}
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors border border-white/10"
              title="Minimizar / Fechar janela"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Barra de Ações Operacionais: Iniciar, Pausar, Conferir, Salvar */}
        {!commitResult && (
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('scan')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'scan'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Barcode className="h-3.5 w-3.5" />
                1. Bipagem por Leitor
              </button>

              <button
                onClick={() => setActiveTab('review')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'review'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                2. Conferir e Ajustar
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Botão Iniciar / Pausar */}
              <button
                onClick={handleTogglePause}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all shadow-xs ${
                  session.status === 'active'
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-300'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {session.status === 'active' ? (
                  <>
                    <Pause className="h-3.5 w-3.5" />
                    Pausar Bipagem
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Retomar Bipagem
                  </>
                )}
              </button>

              {/* Botão Conferir */}
              {activeTab === 'scan' && (
                <button
                  onClick={() => setActiveTab('review')}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 text-xs font-bold transition-all"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Conferir Lote
                </button>
              )}

              {/* Botão Salvar Lote */}
              <button
                onClick={() => handleCommitFinal()}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 px-4 py-1.5 text-xs font-bold transition-all shadow-xs"
              >
                <Save className="h-3.5 w-3.5" />
                Salvar Lote
              </button>

              {/* Botão Descartar Sessão */}
              <button
                onClick={() => {
                  if (
                    confirm(
                      'Tem certeza que deseja descartar este lote? Todas as peças contadas nesta sessão serão zeradas.'
                    )
                  ) {
                    onDiscardSession();
                  }
                }}
                className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                title="Descartar este lote"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Banner de Feedback em Tempo Real (Alerta de Rejeição ou Confirmação) */}
        {alertBanner && (
          <div
            className={`px-4 py-3 flex items-start gap-3 border-b text-xs transition-all ${
              alertBanner.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : alertBanner.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {alertBanner.type === 'error' ? (
                <AlertTriangle className="h-4 w-4 text-rose-600" />
              ) : alertBanner.type === 'warning' ? (
                <Info className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
            </div>
            <div className="flex-1">
              <p className="font-bold">{alertBanner.message}</p>
              {alertBanner.details && <p className="mt-0.5 opacity-90">{alertBanner.details}</p>}
            </div>
            <button
              onClick={() => setAlertBanner(null)}
              className="text-slate-400 hover:text-slate-600 text-xs"
            >
              ×
            </button>
          </div>
        )}

        {/* Erro de Validação de Justificativa */}
        {validationError && (
          <div className="bg-rose-100 border-b border-rose-200 px-4 py-2.5 text-xs text-rose-800 font-bold flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
              {validationError}
            </span>
            <button onClick={() => setValidationError(null)} className="text-rose-500">
              Fechar
            </button>
          </div>
        )}

        {/* CONTEÚDO PRINCIPAL: MODAL COMMIT CONCLUÍDO */}
        {commitResult ? (
          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md mb-3">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">
                {commitResult.idempotent_replay
                  ? 'Reenvio Idempotente Reconhecido (Sem Duplicação)'
                  : 'Lote de Estoque Gravado com Sucesso!'}
              </h3>
              <p className="text-xs text-slate-600 mt-1 max-w-lg mx-auto">
                {commitResult.message} O saldo oficial foi atualizado atomicamente na memória local
                para todas as variações contadas.
              </p>

              <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 border border-emerald-200 text-xs font-mono text-emerald-800 shadow-xs">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>Chave de Idempotência do Lote: {commitResult.batch_idempotency_key}</span>
              </div>
            </div>

            {/* Resumo dos Itens Atualizados */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 font-bold text-xs text-slate-700 flex justify-between items-center">
                <span>Resumo da Atualização Atômica das Variações</span>
                <span className="font-mono text-emerald-700">
                  Total Adicionado: +{commitResult.total_quantity} un
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {commitResult.items.map((it) => (
                  <div key={it.variant_id} className="p-3.5 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-slate-900">
                        {it.color} • Tam {it.size}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        Código: {it.barcode}
                        {it.justification && (
                          <span className="ml-2 text-indigo-700 font-sans">
                            (Justificativa: {it.justification})
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <span className="text-slate-500 text-[11px]">
                        Antes: {it.stock_before} un
                      </span>
                      <span className="inline-flex items-center rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                        +{it.quantity} un
                      </span>
                      <span className="font-black text-slate-900 text-sm">
                        Novo Saldo: {it.stock_after} un
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Ações Finais */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleRetryIdempotentBatch}
                className="flex items-center gap-1.5 rounded-xl border border-purple-300 bg-purple-50 px-3.5 py-2 text-xs font-bold text-purple-700 hover:bg-purple-100 transition-colors"
                title="Simula o reenvio da requisição com a mesma chave UUID para comprovar que o saldo não é duplicado"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Testar Reenvio Idempotente (Mesma Chave)
              </button>

              <button
                onClick={onClose}
                className="rounded-xl bg-slate-900 px-6 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-xs"
              >
                Concluir e Fechar
              </button>
            </div>
          </div>
        ) : activeTab === 'scan' ? (
          /* ABA 1: TELA DE BIPAGEM ATIVA DO LOTE */
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
            {/* Aviso de Operação: Saldo não alterado ainda */}
            <div className="rounded-xl bg-blue-50/70 border border-blue-200 p-3.5 text-xs text-blue-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-600 shrink-0" />
                <span>
                  <strong>Aviso Operacional:</strong> Cada bip soma no contador temporário deste
                  lote. O saldo oficial <strong>NÃO</strong> é alterado até a conferência e salvamento final.
                </span>
              </div>
              <span className="text-[11px] font-mono text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                Exclusivo: {product.sku}
              </span>
            </div>

            {/* Caixa de Entrada Direta de Código de Barras e Quantidade por Leitura */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 pb-3 border-b border-slate-100">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-800">
                    Bipagem com Multiplicador de Quantidade
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Defina quantas peças cada bipe deve registrar. Retorna automaticamente para 1 após o bipe.
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                    Qtd por leitura:
                  </span>
                  <div className="flex items-center gap-1.5">
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
                        if (e.key === 'Enter') {
                          e.preventDefault();
                        }
                      }}
                      className="w-20 rounded-lg border border-slate-300 py-1 px-2 text-center text-xs font-black font-mono text-slate-900 focus:border-indigo-600 focus:outline-hidden bg-slate-50"
                    />
                    <div className="flex gap-1">
                      {[1, 10, 25, 100].map((quick) => (
                        <button
                          key={quick}
                          type="button"
                          onClick={() => setScanMultiplier(quick)}
                          className={`px-2 py-1 rounded text-[11px] font-bold border transition-colors ${
                            scanMultiplier === quick
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {quick}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleProcessScan(manualCode);
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Barcode className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Aponte o leitor USB ou digite o código de barras..."
                    className="w-full rounded-xl border border-slate-300 py-2.5 pl-11 pr-4 text-sm font-mono text-slate-900 focus:border-slate-900 focus:outline-hidden"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors shrink-0"
                >
                  Bipar Peça {scanMultiplier > 1 ? `(+${scanMultiplier} un)` : '(+1 un)'}
                </button>
              </form>

              {/* Botões de Simulação Rápida para as Variantes DESTE Produto */}
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-indigo-500" />
                  Simulação Rápida (Clique para simular bipagens das variações deste lote):
                </p>
                <div className="flex flex-wrap gap-2">
                  {productVariants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => v.barcode && handleProcessScan(v.barcode)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 transition-colors font-medium"
                    >
                      +1 {v.color} ({v.size})
                    </button>
                  ))}

                  {/* Botão de Teste de Rejeição de Outro Produto */}
                  <button
                    type="button"
                    onClick={() => handleProcessScan('7892000200029')}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-100 transition-colors font-semibold"
                    title="Simula bipagem de código pertencente à Calça Alfaiataria (outro produto)"
                  >
                    Simular Bip de Outro Produto (Testar Rejeição)
                  </button>
                </div>
              </div>
            </div>

            {/* Grid de Variações com Contadores Temporários */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center justify-between">
                <span>Variações Deste Produto & Contagem no Lote ({productVariants.length} variantes)</span>
                <span className="text-[11px] font-normal text-slate-500">
                  Cores e tamanhos diferentes podem ser bipados juntos
                </span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {productVariants.map((v) => {
                  const itemCount = session.items[v.id] || {
                    scanned_quantity: 0,
                    final_quantity: 0,
                  };
                  const isCounted = itemCount.scanned_quantity > 0;

                  return (
                    <div
                      key={v.id}
                      className={`rounded-xl border p-3.5 bg-white shadow-xs transition-all flex flex-col justify-between ${
                        isCounted
                          ? 'border-indigo-400 ring-2 ring-indigo-400/10'
                          : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono text-slate-500">
                            {v.barcode || 'Sem código'}
                          </span>
                          <h5 className="text-xs font-bold text-slate-900 mt-0.5">
                            {v.color} • Tam <strong className="text-indigo-900">{v.size}</strong>
                          </h5>
                          <p className="text-[11px] text-slate-500">
                            Saldo oficial atual: {v.stock_quantity} un
                          </p>
                        </div>

                        <div className="text-right">
                          <span
                            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-black font-mono ${
                              isCounted
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            +{itemCount.scanned_quantity}
                          </span>
                        </div>
                      </div>

                      {/* Mini Barcode Code 128 */}
                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                        <span>Padrão Code 128</span>
                        <button
                          type="button"
                          onClick={() => v.barcode && handleProcessScan(v.barcode)}
                          className="font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          Bipar (+1)
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Feed Cronológico das Peças Bipadas na Sessão */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  Histórico de Bipagens Desta Sessão ({session.scan_events.length} bipagens)
                </span>
                {session.scan_events.length > 0 && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    Último: {session.scan_events[0]?.timestamp}
                  </span>
                )}
              </div>

              {session.scan_events.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  Nenhuma peça bipada ainda. Aponte o leitor USB para iniciar a contagem.
                </p>
              ) : (
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 text-xs">
                  {session.scan_events.map((ev) => (
                    <div key={ev.id} className="py-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-600 font-bold font-mono">+1</span>
                        <span className="font-semibold text-slate-800">
                          {ev.color} • Tam {ev.size}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">({ev.barcode})</span>
                      </div>
                      <span className="text-[10px] text-slate-400">{ev.timestamp}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ABA 2: TELA DE CONFERÊNCIA & AJUSTE MANUAL */
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
            <div className="rounded-xl bg-indigo-50/70 border border-indigo-200 p-4 text-xs text-indigo-950 flex items-start gap-3">
              <ClipboardCheck className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">
                  Conferência do Lote: {product.name} ({product.sku})
                </h4>
                <p className="mt-0.5 text-xs text-indigo-900">
                  Revise as quantidades contadas pelo leitor. Se houver divergência física ou peça
                  não identificada pelo código, altere a quantidade final. Toda correção manual
                  exige o registro de uma <strong>justificativa obrigatória</strong> para auditoria.
                </p>
              </div>
            </div>

            {/* Tabela de Conferência das Variantes */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-bold">Variação (Cor / Tam)</th>
                    <th className="py-3 px-4 font-bold">Código de Barras</th>
                    <th className="py-3 px-4 font-bold text-center">Método</th>
                    <th className="py-3 px-4 font-bold text-center">Saldo Atual</th>
                    <th className="py-3 px-4 font-bold text-center">Bipado (Auto)</th>
                    <th className="py-3 px-4 font-bold text-center">Qtd Final</th>
                    <th className="py-3 px-4 font-bold">Justificativa (Se alterado)</th>
                    <th className="py-3 px-4 font-bold text-right">Novo Saldo Previsto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productVariants.map((v) => {
                    const it = session.items[v.id] || {
                      scanned_quantity: 0,
                      final_quantity: 0,
                      manual_adjustment: 0,
                      justification: '',
                    };

                    const hasAdjustment = it.manual_adjustment !== 0;
                    const isMissingJustification =
                      hasAdjustment && (!it.justification || it.justification.trim().length < 4);
                    const newStock = v.stock_quantity + (it.final_quantity || 0);

                    return (
                      <tr
                        key={v.id}
                        className={`hover:bg-slate-50/70 transition-colors ${
                          isMissingJustification ? 'bg-rose-50/50' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {v.color} • Tam {v.size}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">
                          {v.barcode || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              it.scanned_quantity > 0 && it.manual_adjustment === 0
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : it.scanned_quantity === 0 && it.final_quantity > 0
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : it.scanned_quantity > 0 && it.manual_adjustment !== 0
                                ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {it.scanned_quantity > 0 && it.manual_adjustment === 0
                              ? 'Bipagem'
                              : it.scanned_quantity === 0 && it.final_quantity > 0
                              ? 'Manual'
                              : it.scanned_quantity > 0 && it.manual_adjustment !== 0
                              ? 'Misto'
                              : 'Sem alteração'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center text-slate-500">
                          {v.stock_quantity} un
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                            {it.scanned_quantity}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                handleManualQuantityChange(
                                  v.id,
                                  String(Math.max(0, it.final_quantity - 1))
                                )
                              }
                              className="h-6 w-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={it.final_quantity}
                              onChange={(e) => handleManualQuantityChange(v.id, e.target.value)}
                              className={`w-14 rounded-lg border py-1 px-1.5 text-center font-mono font-bold text-xs ${
                                hasAdjustment
                                  ? 'border-amber-400 bg-amber-50 text-amber-900'
                                  : 'border-slate-300 text-slate-900'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleManualQuantityChange(v.id, String(it.final_quantity + 1))
                              }
                              className="h-6 w-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                              title="Adicionar peça manualmente"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {hasAdjustment ? (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={it.justification || ''}
                                onChange={(e) => handleJustificationChange(v.id, e.target.value)}
                                placeholder="Motivo obrigatório (ex: etiqueta rasgada)..."
                                className={`w-full rounded-lg border py-1 px-2.5 text-xs placeholder:text-slate-400 ${
                                  isMissingJustification
                                    ? 'border-rose-400 bg-rose-50/50 focus:ring-rose-500'
                                    : 'border-slate-300'
                                }`}
                              />
                              {isMissingJustification && (
                                <p className="text-[10px] text-rose-600 font-semibold">
                                  Justificativa obrigatória para auditoria.
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">Sem alteração manual</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-black text-slate-900 font-mono text-sm">
                          {newStock} un
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Painel Inferior de Confirmação */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs text-slate-600">
                  Operador responsável:{' '}
                  <strong className="text-slate-900">{session.operator_name}</strong>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Ao salvar, um UUID de idempotência será gerado e todos os saldos serão atualizados
                  de forma atômica.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('scan')}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  ← Voltar para Bipagem
                </button>

                <button
                  type="button"
                  onClick={() => handleCommitFinal()}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-xs"
                >
                  <Save className="h-4 w-4" />
                  Confirmar e Salvar Lote ({totalFinal} un)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
