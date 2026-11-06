'use client';

import React, { useState, useEffect } from 'react';
import {
  ProductVariant,
  Product,
  UserRole,
  BatchScanningSession,
  BatchCommitResult,
} from '@/types/database';
import { BatchScanningModal } from '@/components/modules/BatchScanningModal';
import { ProductCreateModal } from '@/components/modules/ProductCreateModal';
import { ProductEditModal } from '@/components/modules/ProductEditModal';
import { PendingExit } from '@/components/modules/OutputsModule';
import {
  Search,
  Filter,
  Plus,
  Pencil,
  Barcode,
  Lock,
  SlidersHorizontal,
  Printer,
  Layers,
  ArrowLeft,
  Play,
  RotateCw,
  Sparkles,
  LayoutGrid,
  List,
  Eye,
  PackagePlus,
  AlertCircle,
} from 'lucide-react';

interface StockModuleProps {
  variants: (ProductVariant & { product: Product })[];
  currentRole: UserRole;
  pendingExits?: PendingExit[];
  onAddVariant?: (variant: ProductVariant & { product: Product }) => { success: boolean; error?: string } | void;
  onCreateProduct?: (product: Product, newVariants: (ProductVariant & { product: Product })[]) => { success: boolean; error?: string } | void;
  onUpdateProduct?: (product: Product, updatedVariants: (ProductVariant & { product: Product })[]) => { success: boolean; error?: string } | void;
  onNavigateToLabels?: () => void;
  onCommitBatch?: (
    session: BatchScanningSession,
    forcedIdempotencyKey?: string
  ) => BatchCommitResult;
  onConfirmManualEntries?: (entries: {
    variantId: string;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    note?: string;
  }[]) => void;
}

const STORAGE_KEY = 'MB_GRUPO_BATCH_SESSION';

export function StockModule({
  variants,
  currentRole,
  pendingExits = [],
  onAddVariant,
  onCreateProduct,
  onUpdateProduct,
  onNavigateToLabels,
  onCommitBatch,
  onConfirmManualEntries,
}: StockModuleProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sizeFilter, setSizeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [viewMode, setViewMode] = useState<'products' | 'flat'>('products');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showAdminBlockedModal, setShowAdminBlockedModal] = useState(false);

  // Estados dos Formulários Modernos Novo SKU e Editar Produto (Passo 5)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Formato da grade do produto selecionado: Matriz agrupada por Cor (Passo 7) vs Lista Plana
  const [productViewFormat, setProductViewFormat] = useState<'matrix' | 'table'>('matrix');

  // Modo de visualização do produto selecionado: Consulta (padrão) vs Gerenciamento de Entradas (Refinamento Passo 7)
  const [productDetailMode, setProductDetailMode] = useState<'consultation' | 'entries'>('consultation');

  const handleSelectProduct = (prod: Product | null) => {
    setSelectedProduct(prod);
    setProductDetailMode('consultation');
  };

  const handleOpenNewProductModal = () => {
    if (currentRole !== 'admin') {
      setShowAdminBlockedModal(true);
      return;
    }
    setShowCreateModal(true);
  };

  const handleOpenEditModal = (prod: Product, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (currentRole !== 'admin') {
      setShowAdminBlockedModal(true);
      return;
    }
    setEditingProduct(prod);
  };

  // Controle de Entradas Manuais por Variação (+ e quantidade personalizada)
  const [pendingEntries, setPendingEntries] = useState<Record<string, number>>({});
  const [customInputQty, setCustomInputQty] = useState<Record<string, string>>({});
  const [manualSuccessMessage, setManualSuccessMessage] = useState<string | null>(null);

  // Funções de manipulação de entradas manuais
  const handleAddManualUnit = (variantId: string, qty: number = 1) => {
    setPendingEntries((prev) => ({
      ...prev,
      [variantId]: (prev[variantId] || 0) + qty,
    }));
  };

  const handleSubtractManualUnit = (variantId: string) => {
    setPendingEntries((prev) => {
      const current = prev[variantId] || 0;
      if (current <= 1) {
        const next = { ...prev };
        delete next[variantId];
        return next;
      }
      return { ...prev, [variantId]: current - 1 };
    });
  };

  const handleCustomQuantityApply = (variantId: string) => {
    const raw = customInputQty[variantId];
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setPendingEntries((prev) => ({
        ...prev,
        [variantId]: (prev[variantId] || 0) + parsed,
      }));
      setCustomInputQty((prev) => ({ ...prev, [variantId]: '' }));
    }
  };

  const handleClearAllPending = () => {
    setPendingEntries({});
  };

  const handleConfirmManual = () => {
    const entriesToConfirm = Object.entries(pendingEntries)
      .filter(([, qty]) => qty > 0)
      .map(([variantId, qty]) => {
        const variant = variants.find((v) => v.id === variantId);
        const stockBefore = variant?.stock_quantity || 0;
        return {
          variantId,
          quantity: qty,
          stockBefore,
          stockAfter: stockBefore + qty,
          note: `Entrada manual (${qty} un) via Estoque V30`,
        };
      });

    if (entriesToConfirm.length === 0) return;

    if (onConfirmManualEntries) {
      onConfirmManualEntries(entriesToConfirm);
    }

    const totalQty = entriesToConfirm.reduce((a, b) => a + b.quantity, 0);
    setManualSuccessMessage(`Entrada de ${totalQty} un confirmada com sucesso! Saldo oficial atualizado.`);
    setPendingEntries({});
    setTimeout(() => setManualSuccessMessage(null), 4000);
  };

  // Controle do Modal de Bipagem por Lote
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<BatchScanningSession | null>(null);
  const [recoveredSessionAlert, setRecoveredSessionAlert] = useState<BatchScanningSession | null>(
    null
  );

  // Extrai lista única de produtos do catálogo
  const productsMap = new Map<string, Product>();
  variants.forEach((v) => {
    if (v.product && !productsMap.has(v.product.id)) {
      productsMap.set(v.product.id, v.product);
    }
  });
  const products = Array.from(productsMap.values());

  // Checa se há uma sessão de lote não finalizada salva no localStorage (Recuperação de Sessão)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as BatchScanningSession;
        if (parsed && parsed.status !== 'committed' && parsed.product_id) {
          setTimeout(() => {
            setRecoveredSessionAlert(parsed);
            setActiveSession(parsed);
          }, 0);
        }
      }
    } catch {}
  }, []);

  // Badge unificada de status de estoque MB Grupo (Ajuste 1)
  const getVariantStockBadge = (quantity: number) => {
    if (quantity <= 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          Sem estoque
        </span>
      );
    }
    if (quantity <= 15) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Estoque baixo
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Normal
      </span>
    );
  };

  // Badge compacta para as células da matriz visual (Passo 7)
  const getCompactStockBadge = (quantity: number) => {
    if (quantity <= 0) {
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shrink-0"
          title="Sem estoque físico (0 un)"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          Zerado
        </span>
      );
    }
    if (quantity <= 15) {
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-200 shrink-0"
          title="Estoque baixo (≤ 15 un)"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Baixo
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0"
        title="Estoque normal (> 15 un)"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Normal
      </span>
    );
  };

  // Helper de paleta têxtil para visualização de cores na Matriz (Passo 7)
  const getColorHex = (colorName: string): string => {
    const c = colorName.toLowerCase().trim();
    if (c.includes('pret') || c.includes('black')) return '#1e293b';
    if (c.includes('branc') || c.includes('white')) return '#f8fafc';
    if (c.includes('off') || c.includes('creme') || c.includes('marfim')) return '#fef3c7';
    if (c.includes('verd') || c.includes('green') || c.includes('militar')) return '#15803d';
    if (c.includes('azul') || c.includes('blue') || c.includes('marinho')) return '#1d4ed8';
    if (c.includes('vermelh') || c.includes('red') || c.includes('bord')) return '#b91c1c';
    if (c.includes('ros') || c.includes('pink') || c.includes('fucsia')) return '#f43f5e';
    if (c.includes('cinz') || c.includes('gray') || c.includes('mescla') || c.includes('chumbo')) return '#64748b';
    if (c.includes('bege') || c.includes('nude') || c.includes('areia') || c.includes('caqui')) return '#d97706';
    if (c.includes('marrom') || c.includes('brown') || c.includes('caramel') || c.includes('terracot')) return '#78350f';
    if (c.includes('lavand') || c.includes('lil') || c.includes('rox')) return '#8b5cf6';
    if (c.includes('amarel') || c.includes('yellow') || c.includes('mostard')) return '#eab308';
    if (c.includes('laranj') || c.includes('orange')) return '#f97316';
    if (c.includes('jeans')) return '#3b82f6';
    return '#64748b';
  };

  // Ordenação lógica das colunas de tamanho (Passo 7)
  const sortSizes = (sizes: string[]): string[] => {
    const STANDARD_ORDER = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG', 'G1', 'G2', 'G3', 'G4', 'TU', 'UN'];
    return [...sizes].sort((a, b) => {
      const idxA = STANDARD_ORDER.indexOf(a.toUpperCase());
      const idxB = STANDARD_ORDER.indexOf(b.toUpperCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  };

  // Filtra as variantes conforme os critérios de busca
  const filteredVariants = variants.filter((v) => {
    const matchesSearch =
      v.product?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.product?.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (v.barcode && v.barcode.includes(searchTerm)) ||
      v.color.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesSize = sizeFilter === 'ALL' || v.size === sizeFilter;

    // Regra de arquivamento:
    // Por padrão (ALL, CRITICAL, LOW, NORMAL, ACTIVE, INACTIVE), variações arquivadas são ocultadas das operações comuns
    // Se statusFilter === 'ARCHIVED', exibe apenas variações arquivadas
    // Se statusFilter === 'ALL_INCL_ARCHIVED', exibe todas
    if (statusFilter === 'ARCHIVED') {
      if (!v.is_archived) return false;
    } else if (statusFilter === 'ALL_INCL_ARCHIVED') {
      // inclui ambos
    } else {
      // Modos normais: oculta arquivados
      if (v.is_archived) return false;
    }

    const matchesStatus =
      statusFilter === 'ALL' ||
      statusFilter === 'ALL_INCL_ARCHIVED' ||
      statusFilter === 'ARCHIVED' ||
      (statusFilter === 'CRITICAL' && (v.stock_quantity || 0) <= 0) ||
      (statusFilter === 'LOW' && (v.stock_quantity || 0) > 0 && (v.stock_quantity || 0) <= 15) ||
      (statusFilter === 'NORMAL' && (v.stock_quantity || 0) > 15) ||
      (statusFilter === 'ACTIVE' && v.product?.active) ||
      (statusFilter === 'INACTIVE' && !v.product?.active);

    return matchesSearch && matchesSize && matchesStatus;
  });

  const availableSizes = Array.from(new Set(variants.map((v) => v.size))).sort();

  // Filtra produtos conforme busca
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase());

    const activeProductVariants = variants.filter((v) => v.product_id === p.id && !v.is_archived);
    const archivedProductVariants = variants.filter((v) => v.product_id === p.id && v.is_archived);

    let matchesArchived = true;
    if (statusFilter === 'ARCHIVED') {
      matchesArchived = archivedProductVariants.length > 0;
    }

    const matchesStatus =
      statusFilter === 'ALL' ||
      statusFilter === 'ALL_INCL_ARCHIVED' ||
      statusFilter === 'ARCHIVED' ||
      (statusFilter === 'CRITICAL' &&
        activeProductVariants.some((v) => (v.stock_quantity || 0) <= 0)) ||
      (statusFilter === 'LOW' &&
        activeProductVariants.some((v) => (v.stock_quantity || 0) > 0 && (v.stock_quantity || 0) <= 15)) ||
      (statusFilter === 'NORMAL' &&
        activeProductVariants.some((v) => (v.stock_quantity || 0) > 15)) ||
      (statusFilter === 'ACTIVE' && p.active) ||
      (statusFilter === 'INACTIVE' && !p.active);

    return matchesSearch && matchesStatus && matchesArchived;
  });

  // Abertura do lote para um produto
  const handleOpenBatchForProduct = (prod: Product) => {
    setSelectedProduct(prod);
    setIsBatchModalOpen(true);
  };

  // Retomada da sessão recuperada do localStorage
  const handleResumeSavedSession = () => {
    if (!recoveredSessionAlert) return;
    const prod = products.find((p) => p.id === recoveredSessionAlert.product_id);
    if (prod) {
      setSelectedProduct(prod);
      setActiveSession(recoveredSessionAlert);
      setIsBatchModalOpen(true);
      setRecoveredSessionAlert(null);
    }
  };

  const handleDiscardSavedSession = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setRecoveredSessionAlert(null);
    setActiveSession(null);
    setIsBatchModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* BANNER DE RECUPERAÇÃO DE SESSÃO NÃO FINALIZADA (LOCALSTORAGE) */}
      {recoveredSessionAlert && !isBatchModalOpen && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white font-bold shadow-xs">
              <RotateCw className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-900">
                  Sessão de Lote Não Finalizada Encontrada
                </span>
                <span className="inline-flex items-center rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                  Recuperação Automática
                </span>
              </div>
              <p className="text-xs text-amber-800 mt-0.5">
                Existe uma sessão em aberto para o produto{' '}
                <strong>{recoveredSessionAlert.product_name}</strong> (SKU:{' '}
                {recoveredSessionAlert.product_sku}) com{' '}
                <strong>
                  {Object.values(recoveredSessionAlert.items).reduce(
                    (a, b) => a + (b.scanned_quantity || 0),
                    0
                  )}{' '}
                  peças contadas
                </strong>
                .
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={handleDiscardSavedSession}
              className="rounded-xl border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
            >
              Descartar
            </button>
            <button
              onClick={handleResumeSavedSession}
              className="flex items-center gap-1.5 rounded-xl bg-amber-700 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-amber-800 transition-colors"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Retomar Bipagem
            </button>
          </div>
        </div>
      )}

      {/* CABEÇALHO DO MÓDULO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Controle de Estoque & Produtos
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200">
              <Layers className="h-3 w-3" /> Mecânica V30 MB Grupo
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Selecione um produto para visualizar suas variações e iniciar a bipagem por lote.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* Alternador de Visualização: Produtos V30 vs Grade de Variações */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => {
                handleSelectProduct(null);
                setViewMode('products');
              }}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                viewMode === 'products' && !selectedProduct
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Produtos (V30)
            </button>
            <button
              onClick={() => {
                handleSelectProduct(null);
                setViewMode('flat');
              }}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                viewMode === 'flat'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Grade Geral
            </button>
          </div>

          {onNavigateToLabels && (
            <button
              onClick={onNavigateToLabels}
              className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors"
            >
              <Printer className="h-4 w-4 text-slate-500" />
              Imprimir Etiquetas
            </button>
          )}

          <button
            onClick={handleOpenNewProductModal}
            className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Novo Produto
          </button>
        </div>
      </div>

      {/* CASO 1: VISÃO DE VARIAÇÕES DE UM PRODUTO ESPECÍFICO (ORGANIZAÇÃO V30) */}
      {selectedProduct ? (
        <div className="space-y-6">
          {/* Topo do Produto Selecionado */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <button
                onClick={() => handleSelectProduct(null)}
                className="mt-1 p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
                title="Voltar ao catálogo de produtos"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>

              {/* Foto / Ícone do Produto V30 */}
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden shadow-xs">
                {selectedProduct.image_path ? (
                  <img src={selectedProduct.image_path} alt={selectedProduct.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="font-black text-slate-700 text-xl">MB</span>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-md">
                    {selectedProduct.sku}
                  </span>
                  {selectedProduct.active ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                      Modelo Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                      Desativado
                    </span>
                  )}
                </div>

                <h3 className="text-lg font-bold text-slate-900 mt-1">
                  {selectedProduct.name}
                </h3>

                <p className="text-xs text-slate-500 mt-0.5">
                  Organização V30 • Variações por Cor, Estampa e Tamanho
                </p>
              </div>
            </div>

            {/* Ações para Este Produto */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-right px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Saldo Total Oficial
                </span>
                <span className="text-base font-black text-slate-900 font-mono">
                  {variants
                    .filter((v) => v.product_id === selectedProduct.id)
                    .reduce((a, b) => a + b.stock_quantity, 0)}{' '}
                  un
                </span>
              </div>

              {/* Alternador de Modo: Consulta vs Gerenciar Entradas (Refinamento Passo 7) */}
              {productDetailMode === 'consultation' ? (
                <button
                  type="button"
                  data-testid="btn-manage-entries"
                  onClick={() => setProductDetailMode('entries')}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-slate-800 transition-all hover:scale-[1.02] cursor-pointer"
                >
                  <PackagePlus className="h-4 w-4 text-emerald-400" />
                  Gerenciar Entradas
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="btn-back-to-consultation"
                  onClick={() => setProductDetailMode('consultation')}
                  className="flex items-center gap-2 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 px-4 py-2.5 text-xs font-bold shadow-xs hover:bg-emerald-100 transition-all cursor-pointer"
                >
                  <Eye className="h-4 w-4 text-emerald-700" />
                  Voltar à Consulta
                </button>
              )}

              <button
                onClick={() => handleOpenEditModal(selectedProduct)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Pencil className="h-4 w-4 text-slate-500" />
                Editar Produto
              </button>

              <button
                onClick={() => handleOpenBatchForProduct(selectedProduct)}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 transition-all hover:scale-[1.02] cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                Iniciar Bipagem por Lote
              </button>
            </div>
          </div>

          {/* Mensagem de Confirmação de Entrada Manual */}
          {manualSuccessMessage && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-bold text-emerald-800 flex items-center justify-between shadow-xs">
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                {manualSuccessMessage}
              </span>
              <button onClick={() => setManualSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900">
                ×
              </button>
            </div>
          )}

          {/* Grade de Variações do Produto Selecionado: MODO CONSULTA vs MODO GERENCIAMENTO */}
          {(() => {
            const prodVariants = variants.filter((v) => v.product_id === selectedProduct.id);
            const uniqueColors = Array.from(new Set(prodVariants.map((v) => v.color.trim())));
            const rawSizes = Array.from(new Set(prodVariants.map((v) => v.size.trim().toUpperCase())));
            const uniqueSizes = sortSizes(rawSizes);
            const totalProductStock = prodVariants.reduce((a, b) => a + b.stock_quantity, 0);
            const totalProductPending = prodVariants.reduce(
              (acc, v) => acc + (pendingEntries[v.id] || 0),
              0
            );
            const totalProductProjected = totalProductStock + totalProductPending;

            if (productDetailMode === 'consultation') {
              /* 1. MODO CONSULTA (PADRÃO INICIAL LIMPO E CORPORATIVO) */
              return (
                <div className="space-y-4">
                  {/* Aviso discreto caso existam entradas pendentes não salvas */}
                  {totalProductPending > 0 && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span>
                          Existem <strong>+{totalProductPending} peças</strong> pendentes aguardando confirmação no Gerenciador de Entradas.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setProductDetailMode('entries')}
                        className="flex items-center gap-1 font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer text-xs self-end sm:self-auto"
                      >
                        Abrir Gerenciador de Entradas →
                      </button>
                    </div>
                  )}

                  {/* Matriz Limpa de Consulta de Estoque Físico Oficial */}
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                    {/* Cabeçalho da Matriz de Consulta */}
                    <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                            <Eye className="h-4 w-4 text-slate-600" />
                            Consulta de Saldos Oficiais por Cor & Tamanho
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                            {uniqueColors.length} {uniqueColors.length === 1 ? 'cor' : 'cores'} × {uniqueSizes.length} {uniqueSizes.length === 1 ? 'tamanho' : 'tamanhos'} ({prodVariants.length} variações)
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Visualização corporativa e limpa dos saldos reais. Sem botões de movimentação nesta visualização.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 self-start sm:self-auto">
                        <button
                          type="button"
                          onClick={() => setProductDetailMode('entries')}
                          className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <PackagePlus className="h-3.5 w-3.5 text-emerald-600" />
                          Gerenciar Entradas
                        </button>
                      </div>
                    </div>

                    {/* Tabela Matriz de Consulta */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse min-w-[700px]">
                        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 border-b border-slate-200 select-none">
                          <tr>
                            <th className="py-3 px-4 font-bold min-w-[170px] w-[200px]">
                              Cor / Estampa
                            </th>
                            {uniqueSizes.map((sizeName) => {
                              const sizeVars = prodVariants.filter(
                                (v) => v.size.trim().toUpperCase() === sizeName.toUpperCase()
                              );
                              const sizeStock = sizeVars.reduce((sum, v) => sum + v.stock_quantity, 0);

                              return (
                                <th
                                  key={sizeName}
                                  className="py-3 px-3 font-bold text-center border-l border-slate-200 min-w-[140px]"
                                >
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md font-mono font-black text-xs bg-slate-900 text-white shadow-2xs">
                                      {sizeName === 'TU' || sizeName === 'UN' ? sizeName : `Tam. ${sizeName}`}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-medium mt-1 font-mono">
                                    Total: <strong className="text-slate-800">{sizeStock} un</strong>
                                  </div>
                                </th>
                              );
                            })}
                            <th className="py-3 px-4 font-bold text-right border-l border-slate-200 min-w-[130px] w-[140px] bg-slate-100/60">
                              <span className="text-xs uppercase tracking-wider text-slate-700">
                                Total Cor
                              </span>
                              <div className="text-[10px] text-slate-500 font-medium mt-1">
                                Saldo Físico
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {uniqueColors.map((colorName) => {
                            const colorVars = prodVariants.filter(
                              (v) => v.color.trim().toLowerCase() === colorName.toLowerCase()
                            );
                            const colorStock = colorVars.reduce((sum, v) => sum + v.stock_quantity, 0);
                            const hex = getColorHex(colorName);

                            return (
                              <tr key={colorName} className="hover:bg-slate-50/50 transition-colors">
                                {/* Coluna 1: Cor */}
                                <td className="py-4 px-4 align-middle font-bold text-slate-900 bg-white">
                                  <div className="flex items-center gap-2.5">
                                    <span
                                      className="h-4 w-4 rounded-full shrink-0 border border-black/15 shadow-2xs"
                                      style={{ backgroundColor: hex }}
                                    />
                                    <div>
                                      <span className="text-sm font-extrabold text-slate-900 block capitalize">
                                        {colorName}
                                      </span>
                                      <span className="text-[11px] text-slate-500 font-normal block mt-0.5">
                                        {colorVars.length} {colorVars.length === 1 ? 'tamanho' : 'tamanhos'}
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                {/* Colunas por Tamanho */}
                                {uniqueSizes.map((sizeName) => {
                                  const variant = colorVars.find(
                                    (v) => v.size.trim().toUpperCase() === sizeName.toUpperCase()
                                  );

                                  if (!variant) {
                                    return (
                                      <td
                                        key={sizeName}
                                        className="py-3 px-2 align-middle border-l border-slate-100 bg-slate-50/20 text-center"
                                      >
                                        <div className="h-full min-h-[75px] rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center p-2 text-slate-300 select-none">
                                          <span className="font-mono text-xs font-bold">—</span>
                                          <span className="text-[9px] text-slate-400 mt-0.5">
                                            Sem grade
                                          </span>
                                        </div>
                                      </td>
                                    );
                                  }

                                  const isOutOfStock = variant.stock_quantity <= 0;

                                  return (
                                    <td
                                      key={sizeName}
                                      className="py-3 px-2 align-middle border-l border-slate-100"
                                    >
                                      {isOutOfStock ? (
                                        /* Variação Sem Estoque (Destaque discreto em tom rosé suave) */
                                        <div className="rounded-xl border border-rose-200/90 bg-rose-50/40 p-2.5 text-center flex flex-col items-center justify-center space-y-1 transition-colors">
                                          <span className="text-base font-black font-mono text-rose-600">
                                            0 un
                                          </span>
                                          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-bold text-rose-700">
                                            Sem estoque
                                          </span>
                                          <span
                                            className="inline-flex items-center gap-1 font-mono text-[9px] text-slate-400 truncate max-w-[120px] pt-0.5"
                                            title={`Código: ${variant.barcode || variant.id}`}
                                          >
                                            <Barcode className="h-2.5 w-2.5 shrink-0" />
                                            {variant.barcode || 'S/ código'}
                                          </span>
                                        </div>
                                      ) : (
                                        /* Variação com Estoque Real Disponível */
                                        <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center flex flex-col items-center justify-center space-y-1 shadow-2xs hover:border-slate-300 transition-colors">
                                          <span className="text-base font-black font-mono text-slate-900">
                                            {variant.stock_quantity}{' '}
                                            <span className="text-[11px] font-semibold text-slate-500">un</span>
                                          </span>
                                          {getCompactStockBadge(variant.stock_quantity)}
                                          <span
                                            className="inline-flex items-center gap-1 font-mono text-[9px] text-slate-400 truncate max-w-[120px] pt-0.5"
                                            title={`Código: ${variant.barcode || variant.id}`}
                                          >
                                            <Barcode className="h-2.5 w-2.5 shrink-0" />
                                            {variant.barcode || 'S/ código'}
                                          </span>
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}

                                {/* Coluna Total por Cor */}
                                <td className="py-4 px-4 align-middle text-right border-l border-slate-200 bg-slate-50/50">
                                  <span className="text-base font-black font-mono text-slate-900 block">
                                    {colorStock} un
                                  </span>
                                  <span className="text-[11px] text-slate-400 block mt-0.5">
                                    {colorVars.length} {colorVars.length === 1 ? 'variação' : 'variações'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-slate-100/80 border-t-2 border-slate-300 font-mono text-xs">
                          <tr>
                            <td className="py-3.5 px-4 font-bold text-slate-900 uppercase font-sans">
                              Total Geral do Produto
                            </td>
                            {uniqueSizes.map((sizeName) => {
                              const sizeVars = prodVariants.filter(
                                (v) => v.size.trim().toUpperCase() === sizeName.toUpperCase()
                              );
                              const sStock = sizeVars.reduce((sum, v) => sum + v.stock_quantity, 0);

                              return (
                                <td
                                  key={sizeName}
                                  className="py-3.5 px-2 text-center border-l border-slate-200"
                                >
                                  <span className="font-black text-slate-900 block font-mono">
                                    {sStock} un
                                  </span>
                                </td>
                              );
                            })}
                            <td className="py-3.5 px-4 text-right border-l border-slate-200 bg-slate-200/50">
                              <span className="text-base font-black text-slate-900 block font-mono">
                                {totalProductStock} un
                              </span>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              );
            }

            /* 2. MODO GERENCIAR ENTRADAS: MATRIZ OPERACIONAL COM CONTROLES VISÍVEIS */
            return (
              <div className="space-y-4">
                {/* Banner de Conferência de Entrada Manual Pendente */}
                {totalProductPending > 0 && (
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50/80 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold shadow-xs">
                        <Plus className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                            Entrada Manual em Andamento
                          </span>
                          <span className="inline-flex items-center rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                            +{totalProductPending} un. pendentes
                          </span>
                        </div>
                        <p className="text-xs text-emerald-800 mt-0.5">
                          Saldo atual: <strong>{totalProductStock} un</strong> → Saldo previsto:{' '}
                          <strong className="text-emerald-950 font-black">{totalProductProjected} un</strong>.{' '}
                          O saldo oficial será atualizado após clicar em Confirmar Entrada.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        onClick={handleClearAllPending}
                        className="rounded-xl border border-emerald-300 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer"
                      >
                        Desfazer / Limpar
                      </button>
                      <button
                        onClick={handleConfirmManual}
                        className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-md hover:bg-emerald-700 transition-all hover:scale-[1.02] cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Confirmar Entrada
                      </button>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                  {/* Cabeçalho da Grade / Matriz Operacional */}
                  <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                          <PackagePlus className="h-4 w-4 text-emerald-600" />
                          Gerenciador Operacional de Entradas — Matriz de Variações por Cor & Tamanho
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                          {uniqueColors.length} {uniqueColors.length === 1 ? 'cor' : 'cores'} × {uniqueSizes.length} {uniqueSizes.length === 1 ? 'tamanho' : 'tamanhos'} ({prodVariants.length} variações)
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Controles de entrada manual (+1, +10, +25, +100 e quantidade personalizada) visíveis e vinculados diretamente a cada variação.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => setProductDetailMode('consultation')}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer mr-1"
                      >
                        <Eye className="h-3.5 w-3.5 text-slate-500" />
                        Voltar à Consulta
                      </button>

                      {/* Alternador de visualização: Matriz por Cor (Passo 7) vs Lista Plana */}
                      <div className="flex items-center bg-white p-1 rounded-xl border border-slate-200 shadow-2xs text-xs">
                        <button
                          type="button"
                          onClick={() => setProductViewFormat('matrix')}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                            productViewFormat === 'matrix'
                              ? 'bg-slate-900 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <LayoutGrid className="h-3.5 w-3.5" />
                          Matriz por Cor
                        </button>
                        <button
                          type="button"
                          onClick={() => setProductViewFormat('table')}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                            productViewFormat === 'table'
                              ? 'bg-slate-900 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <List className="h-3.5 w-3.5" />
                          Lista Plana
                        </button>
                      </div>
                    </div>
                  </div>

                {productViewFormat === 'matrix' ? (
                  /* 1. VISÃO EM MATRIZ AGRUPADA POR COR (PASSO 7) */
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse min-w-[760px]">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 border-b border-slate-200 select-none">
                        <tr>
                          <th className="py-3 px-4 font-bold min-w-[170px] w-[200px]">
                            Cor / Estampa
                          </th>
                          {uniqueSizes.map((sizeName) => {
                            const sizeVars = prodVariants.filter(
                              (v) => v.size.trim().toUpperCase() === sizeName.toUpperCase()
                            );
                            const sizeStock = sizeVars.reduce((sum, v) => sum + v.stock_quantity, 0);
                            const sizePending = sizeVars.reduce(
                              (sum, v) => sum + (pendingEntries[v.id] || 0),
                              0
                            );

                            return (
                              <th
                                key={sizeName}
                                className="py-3 px-3 font-bold text-center border-l border-slate-200 min-w-[195px] max-w-[240px]"
                              >
                                <div className="flex items-center justify-center gap-1.5">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono font-black text-xs bg-slate-900 text-white shadow-2xs">
                                    {sizeName === 'TU' || sizeName === 'UN' ? sizeName : `Tam. ${sizeName}`}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-medium mt-1 font-mono">
                                  Total: <strong className="text-slate-800">{sizeStock} un</strong>
                                  {sizePending > 0 && (
                                    <span className="text-emerald-700 font-bold ml-1">
                                      +{sizePending}
                                    </span>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                          <th className="py-3 px-4 font-bold text-right border-l border-slate-200 min-w-[130px] w-[140px] bg-slate-100/60">
                            <span className="text-xs uppercase tracking-wider text-slate-700">
                              Total Cor
                            </span>
                            <div className="text-[10px] text-slate-500 font-medium mt-1">
                              Saldo Físico
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {uniqueColors.map((colorName) => {
                          const colorVars = prodVariants.filter(
                            (v) => v.color.trim().toLowerCase() === colorName.toLowerCase()
                          );
                          const colorStock = colorVars.reduce((sum, v) => sum + v.stock_quantity, 0);
                          const colorPending = colorVars.reduce(
                            (sum, v) => sum + (pendingEntries[v.id] || 0),
                            0
                          );
                          const colorProjected = colorStock + colorPending;
                          const hex = getColorHex(colorName);

                          return (
                            <tr key={colorName} className="hover:bg-slate-50/50 transition-colors">
                              {/* Coluna 1: Identificação da Cor */}
                              <td className="py-4 px-4 align-top font-bold text-slate-900 bg-white">
                                <div className="flex items-start gap-2.5">
                                  <span
                                    className="h-4 w-4 rounded-full shrink-0 border border-black/15 shadow-2xs mt-0.5"
                                    style={{ backgroundColor: hex }}
                                  />
                                  <div>
                                    <span className="text-sm font-extrabold text-slate-900 block capitalize">
                                      {colorName}
                                    </span>
                                    <span className="text-[11px] text-slate-500 font-normal block mt-0.5">
                                      {colorVars.length} {colorVars.length === 1 ? 'tamanho' : 'tamanhos'}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {/* Colunas por Tamanho */}
                              {uniqueSizes.map((sizeName) => {
                                const variant = colorVars.find(
                                  (v) => v.size.trim().toUpperCase() === sizeName.toUpperCase()
                                );

                                if (!variant) {
                                  return (
                                    <td
                                      key={sizeName}
                                      className="py-3 px-2 align-middle border-l border-slate-100 bg-slate-50/20 text-center"
                                    >
                                      <div className="h-full min-h-[120px] rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center p-2 text-slate-300 select-none">
                                        <span className="font-mono text-xs font-bold">—</span>
                                        <span className="text-[9px] text-slate-400 mt-0.5">
                                          Sem grade
                                        </span>
                                      </div>
                                    </td>
                                  );
                                }

                                const pendingQty = pendingEntries[variant.id] || 0;
                                const projectedStock = variant.stock_quantity + pendingQty;

                                return (
                                  <td
                                    key={sizeName}
                                    className="py-3 px-2 align-top border-l border-slate-100"
                                  >
                                    <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xs space-y-2 hover:border-slate-300 transition-colors">
                                      {/* Topo do Card: Código de barras + Status */}
                                      <div className="flex items-center justify-between gap-1">
                                        <span
                                          className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 truncate max-w-[130px]"
                                          title={`Código de barras: ${variant.barcode || variant.id}`}
                                        >
                                          <Barcode className="h-3 w-3 text-slate-400 shrink-0" />
                                          {variant.barcode || 'S/ código'}
                                        </span>

                                        {getCompactStockBadge(variant.stock_quantity)}
                                      </div>

                                      {/* Meio: Saldo Atual e Previsto */}
                                      <div className="flex items-baseline justify-between pt-0.5">
                                        <div>
                                          <span className="text-[10px] uppercase font-bold text-slate-400 block leading-tight">
                                            Saldo
                                          </span>
                                          <span className="text-sm font-black font-mono text-slate-900 leading-tight">
                                            {variant.stock_quantity} un
                                          </span>
                                        </div>

                                        {pendingQty > 0 && (
                                          <div className="text-right">
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 leading-tight">
                                              +{pendingQty} un
                                            </span>
                                            <span className="text-[10px] font-mono font-bold text-emerald-700 block mt-0.5">
                                              → {projectedStock} un
                                            </span>
                                          </div>
                                        )}
                                      </div>

                                      {/* Controles de Entrada Manual - SEMPRE VISÍVEIS (REGRA OBRIGATÓRIA) */}
                                      <div className="pt-1.5 border-t border-slate-100 space-y-1.5">
                                        {/* Linha 1: +1 rápido, input personalizado, botão +, e botão -1 se pendente */}
                                        <div className="flex items-center gap-1">
                                          <button
                                            type="button"
                                            data-testid={`btn-plus-${variant.id}`}
                                            onClick={() => handleAddManualUnit(variant.id, 1)}
                                            className="flex items-center gap-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 font-bold text-xs shadow-2xs transition-colors cursor-pointer shrink-0"
                                            title="Adicionar +1 unidade"
                                          >
                                            <Plus className="h-3 w-3" />
                                            <span>1</span>
                                          </button>

                                          <input
                                            type="number"
                                            min={1}
                                            placeholder="Qtd"
                                            value={customInputQty[variant.id] || ''}
                                            onChange={(e) =>
                                              setCustomInputQty((prev) => ({
                                                ...prev,
                                                [variant.id]: e.target.value,
                                              }))
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleCustomQuantityApply(variant.id);
                                              }
                                            }}
                                            className="w-12 min-w-0 rounded-lg border border-slate-300 py-0.5 px-1 text-center text-xs font-mono font-bold text-slate-800 focus:border-emerald-600 focus:outline-hidden bg-slate-50"
                                          />

                                          <button
                                            type="button"
                                            onClick={() => handleCustomQuantityApply(variant.id)}
                                            className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-1.5 py-0.5 text-xs font-bold text-slate-700 transition-colors shadow-2xs cursor-pointer"
                                            title="Aplicar quantidade digitada"
                                          >
                                            +
                                          </button>

                                          {pendingQty > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => handleSubtractManualUnit(variant.id)}
                                              className="rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-1.5 py-0.5 text-xs font-bold transition-colors cursor-pointer"
                                              title="Diminuir 1 peça pendente"
                                            >
                                              -1
                                            </button>
                                          )}
                                        </div>

                                        {/* Linha 2: Chips rápidos (+10, +25, +100) */}
                                        <div className="grid grid-cols-3 gap-1">
                                          {[10, 25, 100].map((quick) => (
                                            <button
                                              key={quick}
                                              type="button"
                                              onClick={() => handleAddManualUnit(variant.id, quick)}
                                              className="rounded-md border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 py-0.5 text-[10px] font-bold text-slate-600 hover:text-emerald-700 transition-colors cursor-pointer text-center"
                                              title={`Adicionar +${quick} unidades`}
                                            >
                                              +{quick}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                );
                              })}

                              {/* Coluna N+1: Total da Cor */}
                              <td className="py-4 px-4 align-middle text-right border-l border-slate-200 bg-slate-50/50">
                                <span className="text-base font-black font-mono text-slate-900 block">
                                  {colorStock} un
                                </span>
                                {colorPending > 0 ? (
                                  <div className="mt-1">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      +{colorPending} un
                                    </span>
                                    <span className="text-xs font-mono font-extrabold text-emerald-700 block mt-0.5">
                                      → {colorProjected} un
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-slate-400 block mt-0.5">
                                    Sem pendências
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-100/80 border-t-2 border-slate-300 font-mono text-xs">
                        <tr>
                          <td className="py-3.5 px-4 font-bold text-slate-900 uppercase font-sans">
                            Total Geral do Produto
                          </td>
                          {uniqueSizes.map((sizeName) => {
                            const sizeVars = prodVariants.filter(
                              (v) => v.size.trim().toUpperCase() === sizeName.toUpperCase()
                            );
                            const sStock = sizeVars.reduce((sum, v) => sum + v.stock_quantity, 0);
                            const sPending = sizeVars.reduce(
                              (sum, v) => sum + (pendingEntries[v.id] || 0),
                              0
                            );

                            return (
                              <td
                                key={sizeName}
                                className="py-3.5 px-2 text-center border-l border-slate-200"
                              >
                                <span className="font-black text-slate-900 block font-mono">
                                  {sStock} un
                                </span>
                                {sPending > 0 && (
                                  <span className="text-emerald-700 text-[10px] font-bold block font-mono">
                                    +{sPending} pend.
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="py-3.5 px-4 text-right border-l border-slate-200 bg-slate-200/50">
                            <span className="text-base font-black text-slate-900 block font-mono">
                              {totalProductStock} un
                            </span>
                            {totalProductPending > 0 && (
                              <span className="text-xs font-bold text-emerald-700 block font-mono">
                                → {totalProductProjected} un
                              </span>
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  /* 2. VISÃO EM LISTA PLANA (MODO ALTERNATIVO) */
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-5 font-bold">Cor / Estampa</th>
                          <th className="py-3 px-5 font-bold">Tamanho</th>
                          <th className="py-3 px-5 font-bold">Código de Barras</th>
                          <th className="py-3 px-5 font-bold text-center">Status</th>
                          <th className="py-3 px-5 font-bold text-right">Saldo Atual</th>
                          <th className="py-3 px-5 font-bold text-center">Entrada Pendente</th>
                          <th className="py-3 px-5 font-bold text-right">Saldo Previsto</th>
                          <th className="py-3 px-5 font-bold text-center">Ação (Entrada)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {prodVariants.map((v) => {
                          const pendingQty = pendingEntries[v.id] || 0;
                          const projectedStock = v.stock_quantity + pendingQty;

                          return (
                            <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-3.5 px-5 font-bold text-slate-900 flex items-center gap-2">
                                <span
                                  className="h-3.5 w-3.5 rounded-full border border-black/15 shadow-2xs"
                                  style={{ backgroundColor: getColorHex(v.color) }}
                                />
                                {v.color}
                              </td>
                              <td className="py-3.5 px-5 font-extrabold text-slate-900">
                                <span className="border border-slate-300 px-2 py-0.5 rounded font-mono">
                                  {v.size}
                                </span>
                              </td>
                              <td className="py-3.5 px-5">
                                <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                                  <Barcode className="h-3.5 w-3.5 text-slate-400" />
                                  {v.barcode || 'Sem código'}
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-center">
                                {getVariantStockBadge(v.stock_quantity)}
                              </td>
                              <td className="py-3.5 px-5 text-right font-mono font-black text-slate-900 text-sm">
                                {v.stock_quantity} un
                              </td>
                              <td className="py-3.5 px-5 text-center">
                                {pendingQty > 0 ? (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-mono font-extrabold text-xs border border-emerald-300 shadow-2xs">
                                    +{pendingQty} un
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-mono text-xs">0</span>
                                )}
                              </td>
                              <td className="py-3.5 px-5 text-right font-mono font-black text-sm">
                                <span className={pendingQty > 0 ? 'text-emerald-700' : 'text-slate-900'}>
                                  {projectedStock} un
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-center">
                                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                  {/* Botão + rápido (+1) */}
                                  <button
                                    type="button"
                                    data-testid={`btn-plus-${v.id}`}
                                    onClick={() => handleAddManualUnit(v.id, 1)}
                                    className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 font-bold text-xs shadow-xs transition-colors cursor-pointer"
                                    title="Adicionar 1 peça à contagem pendente"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    <span>+1</span>
                                  </button>

                                  {/* Input de quantidade personalizada */}
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      min={1}
                                      placeholder="Qtd"
                                      value={customInputQty[v.id] || ''}
                                      onChange={(e) =>
                                        setCustomInputQty((prev) => ({
                                          ...prev,
                                          [v.id]: e.target.value,
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          handleCustomQuantityApply(v.id);
                                        }
                                      }}
                                      className="w-16 rounded-lg border border-slate-300 py-1 px-1.5 text-center text-xs font-mono font-bold text-slate-800 focus:border-emerald-600 focus:outline-hidden bg-slate-50"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleCustomQuantityApply(v.id)}
                                      className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700 transition-colors"
                                      title="Aplicar quantidade digitada"
                                    >
                                      +
                                    </button>
                                  </div>

                                  {/* Chips rápidos (+10, +25, +100) */}
                                  <div className="hidden lg:flex items-center gap-1">
                                    {[10, 25, 100].map((quick) => (
                                      <button
                                        key={quick}
                                        type="button"
                                        onClick={() => handleAddManualUnit(v.id, quick)}
                                        className="rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors"
                                      >
                                        +{quick}
                                      </button>
                                    ))}
                                  </div>

                                  {/* Botão de desfazer / diminuir se houver contagem */}
                                  {pendingQty > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleSubtractManualUnit(v.id)}
                                      className="rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-2 py-1 text-xs font-bold transition-colors"
                                      title="Diminuir 1 peça"
                                    >
                                      -1
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        </div>
      ) : (
        /* CASO 2: CATÁLOGO DE PRODUTOS V30 (PADRÃO) OU GRADE COMPLETA */
        <div className="space-y-6">
          {/* Barra de Filtros */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Busca por texto */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por produto, SKU, código de barras ou cor..."
                  className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-hidden"
                />
              </div>

              {/* Filtro por Tamanho */}
              <div className="flex items-center gap-2">
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

              {/* Filtro por Status */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400 shrink-0" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 py-2 px-3 text-xs text-slate-700 focus:border-slate-900 focus:outline-hidden bg-white"
                >
                  <option value="ALL">Todos os Status (Ativos)</option>
                  <option value="CRITICAL">Sem estoque (0 un.)</option>
                  <option value="LOW">Estoque baixo (1 - 15 un.)</option>
                  <option value="NORMAL">Normal (&gt; 15 un.)</option>
                  <option value="ACTIVE">Apenas Modelos Ativos</option>
                  <option value="INACTIVE">Apenas Modelos Desativados</option>
                  <option value="ARCHIVED">Apenas SKUs Arquivados</option>
                  <option value="ALL_INCL_ARCHIVED">Todos (inclusive Arquivados)</option>
                </select>
              </div>
            </div>
          </div>

          {viewMode === 'products' ? (
            /* LISTAGEM DE PRODUTOS V30 */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredProducts.map((p) => {
                const prodVariants = variants.filter((v) => v.product_id === p.id);
                const totalStock = prodVariants.reduce((a, b) => a + b.stock_quantity, 0);
                const zeroCount = prodVariants.filter((v) => (v.stock_quantity || 0) <= 0).length;
                const inStockCount = prodVariants.filter((v) => (v.stock_quantity || 0) > 0).length;

                return (
                  <div
                    key={p.id}
                    data-product-sku={p.sku}
                    onClick={() => handleSelectProduct(p)}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-slate-400 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div className="flex items-start gap-4">
                      {/* Foto / Thumbnail do Produto */}
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden group-hover:scale-105 transition-transform shadow-xs">
                        {p.image_path ? (
                          <img src={p.image_path} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="font-black text-slate-700">MB</span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                            {p.sku}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {totalStock === 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                Sem estoque
                              </span>
                            ) : inStockCount > 0 && zeroCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                Parcial ({inStockCount}/{prodVariants.length})
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                Disponível
                              </span>
                            )}
                          </div>
                        </div>

                        <h3 className="text-sm font-bold text-slate-900 mt-1 truncate group-hover:text-indigo-600 transition-colors">
                          {p.name}
                        </h3>

                        <p className="text-xs text-slate-500 mt-1">
                          {prodVariants.length} variações (Cores e Tamanhos)
                        </p>
                      </div>
                    </div>

                    {/* Rodapé do Card do Produto */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <span>Saldo Total:</span>
                        <strong className="text-slate-900 font-mono text-sm">
                          {totalStock} un
                        </strong>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => handleOpenEditModal(p, e)}
                          className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                          title="Editar dados, fotos e grade deste produto"
                        >
                          <Pencil className="h-3.5 w-3.5 text-slate-500" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenBatchForProduct(p);
                          }}
                          className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          Bipar Lote
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* TABELA COMPLETA DE TODAS AS VARIAÇÕES */
            <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-3.5 px-4 font-bold">Produto / Modelo</th>
                      <th className="py-3.5 px-4 font-bold">SKU Base</th>
                      <th className="py-3.5 px-4 font-bold">Cor</th>
                      <th className="py-3.5 px-4 font-bold">Tam</th>
                      <th className="py-3.5 px-4 font-bold">Código de Barras (EAN)</th>
                      <th className="py-3.5 px-4 font-bold text-center">Status</th>
                      <th className="py-3.5 px-4 font-bold text-right">Saldo Físico</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredVariants.map((v) => (
                      <tr
                        key={v.id}
                        onClick={() => v.product && handleSelectProduct(v.product)}
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {v.product?.name}
                        </td>
                        <td className="py-3 px-4 font-mono font-medium text-slate-600">
                          {v.product?.sku}
                        </td>
                        <td className="py-3 px-4 text-slate-700">{v.color}</td>
                        <td className="py-3 px-4 font-bold text-slate-900">{v.size}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                            <Barcode className="h-3 w-3 text-slate-400" />
                            {v.barcode || 'Sem código'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {getVariantStockBadge(v.stock_quantity)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">
                          {v.stock_quantity} un
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL DE BIPAGEM POR LOTE DO PRODUTO SELECIONADO */}
      {isBatchModalOpen && selectedProduct && onCommitBatch && (
        <BatchScanningModal
          product={selectedProduct}
          allVariants={variants}
          currentRole={currentRole}
          initialSession={activeSession}
          onClose={() => setIsBatchModalOpen(false)}
          onCommitBatch={onCommitBatch}
          onDiscardSession={handleDiscardSavedSession}
          onNavigateToLabels={onNavigateToLabels}
        />
      )}

      {/* Modal Educativo de Bloqueio RLS para Operador */}
      {showAdminBlockedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 border border-rose-200">
                <Lock className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Ação Restrita a Administradores</h3>
            </div>
            <p className="mt-3 text-xs text-slate-600 leading-relaxed">
              O seu perfil ativo é <strong className="text-slate-900">Operador</strong>. Conforme a
              política de segurança e governança de estoque do MB Grupo, o cadastro de novos modelos e a
              edição estrutural de produtos exigem autenticação válida de <strong className="text-slate-900">Administrador</strong>.
            </p>
            <p className="mt-2 text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
              Para cadastrar novos SKUs ou editar modelos, encerre a sessão atual ou utilize a opção <strong>Trocar de Operador</strong> no cabeçalho e efetue o login com credenciais administrativas.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdminBlockedModal(false)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. MODAL NOVO SKU (REFERÊNCIA IMAGEM 1) */}
      {showCreateModal && (
        <ProductCreateModal
          existingVariants={variants}
          onClose={() => setShowCreateModal(false)}
          onSuccess={(newProduct, newVariants) => {
            if (onCreateProduct) {
              const res = onCreateProduct(newProduct, newVariants);
              if (res && res.success === false) {
                alert(`Erro ao gravar novo SKU: ${res.error}`);
                return;
              }
            } else if (onAddVariant) {
              newVariants.forEach((v) => onAddVariant(v));
            }
            alert(
              `Produto "${newProduct.name}" (SKU: ${newProduct.sku}) cadastrado com sucesso com ${newVariants.length} variação(ões) com saldo ZERO!`
            );
            setShowCreateModal(false);
          }}
        />
      )}

      {/* 2. MODAL EDITAR PRODUTO (REFERÊNCIA IMAGEM 2) */}
      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          allVariants={variants}
          pendingExits={pendingExits}
          pendingExitsCount={(() => {
            const prodVariantIds = new Set(
              variants
                .filter(
                  (v) =>
                    v.product_id === editingProduct.id ||
                    (v.product && v.product.sku.toLowerCase() === editingProduct.sku.toLowerCase())
                )
                .map((v) => v.id)
            );
            return pendingExits
              .filter((e) => prodVariantIds.has(e.variantId))
              .reduce((sum, e) => sum + e.quantity, 0);
          })()}
          currentRole={currentRole}
          onClose={() => setEditingProduct(null)}
          onSuccess={(updatedProduct, updatedVariants) => {
            if (onUpdateProduct) {
              const res = onUpdateProduct(updatedProduct, updatedVariants);
              if (res && res.success === false) {
                alert(`Erro ao atualizar produto: ${res.error}`);
                return;
              }
            }
            if (selectedProduct && selectedProduct.id === updatedProduct.id) {
              setSelectedProduct(updatedProduct);
            }
            alert(`Produto "${updatedProduct.name}" atualizado com sucesso!`);
            setEditingProduct(null);
          }}
        />
      )}
    </div>
  );
}
