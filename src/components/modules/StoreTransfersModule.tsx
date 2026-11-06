'use client';

/**
 * ESTOQUE DIGITAL — MB GRUPO
 * MÓDULO COMPLEMENTAR: ACERTO ENTRE LOJAS (BIA ↔ CARLOS)
 * REORGANIZAÇÃO EM DOIS PAINÉIS LADO A LADO COM REGRAS ESPECÍFICAS DE ESTOQUE
 *
 * Arquitetura e Regras:
 * 1. Painel Esquerdo — Bia pegou de Carlos:
 *    - Foco em bipagem USB de recebimento (+ multiplicador de leitura).
 *    - Histórico próprio de recebimentos da Bia.
 *    - REGRA DE ESTOQUE: Apenas controle financeiro e administrativo. NÃO debita nem credita o estoque principal da Bia.
 * 2. Painel Direito — Carlos pegou de Bia:
 *    - Foco em seleção manual de produto, cor, tamanho e quantidade (com pesquisa rápida).
 *    - Bipagem opcional compatível com leitor USB.
 *    - Histórico próprio de retiradas do Carlos.
 *    - REGRA DE ESTOQUE: Validação estrita do saldo disponível da Bia; na confirmação, realiza baixa definitiva via IStockRepository.
 *    - Prevenção de saldo negativo, operação atômica e idempotente. Baixa nunca reaplicada em reaberturas.
 * 3. Preços:
 *    - Busca na Tabela de Preços de Repasse por variantId estável.
 *    - Preço opcional: permite lançamentos sem preço cadastrado, identificando itens com "Valor pendente".
 * 4. Responsividade:
 *    - Grid lado a lado em desktop (lg:grid-cols-2) e vertical em telas menores (grid-cols-1).
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ProductVariant, Product, UserRole, StockMovement } from '@/types/database';
import {
  StoreTransferRecord,
  StoreTransferDirection,
  StoreTransferBatchItem,
  MonthlySettlement,
  StoreBalanceSummary,
  StoreTransferPrice,
  StoreTransferPriceAuditLog,
} from '@/types/store-transfers';
import {
  safeGetStorage,
  safeSetStorage,
  STORAGE_KEY_STORE_TRANSFERS,
  STORAGE_KEY_STORE_SETTLEMENTS,
  STORAGE_KEY_STORE_TRANSFER_PRICES,
  STORAGE_KEY_STORE_TRANSFER_PRICE_AUDIT,
} from '@/lib/storage-service';
import {
  getStoreTransferPrices,
  getStoreTransferPriceByVariantId,
  saveStoreTransferPrice,
  getStoreTransferPriceAuditLogs,
} from '@/lib/store-transfers-price-service';
import { resolveScannedBarcode } from '@/lib/barcode-service';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useAuth } from '@/contexts/AuthContext';
import { getStockRepository } from '@/lib/repositories';
import {
  ArrowLeftRight,
  Plus,
  CalendarCheck,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  ScanBarcode,
  Coins,
  ShieldAlert,
  ArrowDownLeft,
  ArrowUpRight,
  Store,
  Layers,
  Trash2,
  Barcode,
  Package,
  X,
  Sparkles,
  Tag,
  History,
  Lock,
  Pencil,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Minus,
  Check,
  FileSpreadsheet,
  Info,
} from 'lucide-react';

interface StoreTransfersModuleProps {
  variants: (ProductVariant & { product: Product })[];
  currentRole: UserRole;
  onStockDeducted?: (
    newMovements: StockMovement[],
    updatedVariants: (ProductVariant & { product: Product })[]
  ) => void;
}

export function StoreTransfersModule({
  variants,
  currentRole,
  onStockDeducted,
}: StoreTransfersModuleProps) {
  const { user } = useAuth();
  const isAdmin = currentRole === 'admin';

  // Estados locais de persistência
  const [transfers, setTransfers] = useState<StoreTransferRecord[]>([]);
  const [settlements, setSettlements] = useState<MonthlySettlement[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Navegação entre Abas Principais
  const [activeTabSub, setActiveTabSub] = useState<'panels' | 'prices' | 'settlements'>('panels');

  // Estados dos Modais
  const [isBiaReceiptModalOpen, setIsBiaReceiptModalOpen] = useState(false);
  const [isCarlosWithdrawalModalOpen, setIsCarlosWithdrawalModalOpen] = useState(false);
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [selectedTransferForDetails, setSelectedTransferForDetails] = useState<StoreTransferRecord | null>(null);

  // Filtros dos Painéis de Histórico
  const [biaSearch, setBiaSearch] = useState('');
  const [biaStatusFilter, setBiaStatusFilter] = useState<'all' | 'open' | 'settled'>('all');

  const [carlosSearch, setCarlosSearch] = useState('');
  const [carlosStatusFilter, setCarlosStatusFilter] = useState<'all' | 'open' | 'settled'>('all');

  // ─── ESTADOS DA TABELA DE PREÇOS DE REPASSE E AUDITORIA ───
  const [pricesMap, setPricesMap] = useState<Record<string, StoreTransferPrice>>({});
  const [priceAuditLogs, setPriceAuditLogs] = useState<StoreTransferPriceAuditLog[]>([]);
  const [priceSearch, setPriceSearch] = useState('');
  const [priceFilterStatus, setPriceFilterStatus] = useState<'all' | 'priced' | 'unpriced'>('all');
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [editingVariantPrice, setEditingVariantPrice] = useState<(ProductVariant & { product: Product }) | null>(null);
  const [priceInputVal, setPriceInputVal] = useState<string>('');
  const [priceReasonVal, setPriceReasonVal] = useState<string>('');
  const [priceModalError, setPriceModalError] = useState<string>('');

  // ─── ESTADOS DO MODAL: BIA PEGOU DE CARLOS (RECEBIMENTO VIA BIPAGEM) ───
  const [biaScanMultiplier, setBiaScanMultiplier] = useState<number>(1);
  const [biaManualBarcodeInput, setBiaManualBarcodeInput] = useState('');
  const [biaBatchItems, setBiaBatchItems] = useState<StoreTransferBatchItem[]>([]);
  const [biaBatchNote, setBiaBatchNote] = useState('');
  const [biaFeedback, setBiaFeedback] = useState<{ type: 'success' | 'error' | null; message: string }>({
    type: null,
    message: '',
  });

  // ─── ESTADOS DO MODAL: CARLOS PEGOU DE BIA (RETIRADA MANUAL + BIPAGEM OPCIONAL) ───
  const [carlosSearchQuery, setCarlosSearchQuery] = useState('');
  const [carlosSelectedProductId, setCarlosSelectedProductId] = useState('');
  const [carlosSelectedVariantId, setCarlosSelectedVariantId] = useState('');
  const [carlosQuantity, setCarlosQuantity] = useState<number>(1);
  const [carlosShowScanner, setCarlosShowScanner] = useState(false);
  const [carlosManualBarcodeInput, setCarlosManualBarcodeInput] = useState('');
  const [carlosBatchItems, setCarlosBatchItems] = useState<StoreTransferBatchItem[]>([]);
  const [carlosBatchNote, setCarlosBatchNote] = useState('');
  const [carlosFeedback, setCarlosFeedback] = useState<{ type: 'success' | 'error' | null; message: string }>({
    type: null,
    message: '',
  });

  // Estado de envio
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);

  // Formulário de Fechamento Mensal
  const [settlementMonth, setSettlementMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [settlementNote, setSettlementNote] = useState('');

  const biaBarcodeInputRef = useRef<HTMLInputElement>(null);
  const carlosBarcodeInputRef = useRef<HTMLInputElement>(null);

  // ─── CARREGAMENTO INICIAL DE DADOS ───
  useEffect(() => {
    const savedTransfers = safeGetStorage<StoreTransferRecord[]>(STORAGE_KEY_STORE_TRANSFERS);
    if (savedTransfers.success && Array.isArray(savedTransfers.data)) {
      setTransfers(savedTransfers.data);
    }

    const savedSettlements = safeGetStorage<MonthlySettlement[]>(STORAGE_KEY_STORE_SETTLEMENTS);
    if (savedSettlements.success && Array.isArray(savedSettlements.data)) {
      setSettlements(savedSettlements.data);
    }

    const loadedPrices = getStoreTransferPrices();
    setPricesMap(loadedPrices);

    const loadedAudit = getStoreTransferPriceAuditLogs();
    setPriceAuditLogs(loadedAudit);

    setIsLoaded(true);
  }, []);

  // Helper para persistir transferências
  const persistTransfers = (updated: StoreTransferRecord[]) => {
    setTransfers(updated);
    safeSetStorage(STORAGE_KEY_STORE_TRANSFERS, updated);
  };

  // ─── CATÁLOGO AGRUPADO DE PRODUTOS ───
  const productsMap = useMemo(() => {
    const map = new Map<string, Product>();
    variants.forEach((v) => {
      if (v.product && !map.has(v.product.id)) {
        map.set(v.product.id, v.product);
      }
    });
    return map;
  }, [variants]);

  const uniqueProducts = useMemo(() => {
    return Array.from(productsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsMap]);

  // Variações do produto selecionado para Carlos
  const carlosProductVariants = useMemo(() => {
    if (!carlosSelectedProductId) return [];
    return variants.filter((v) => v.product_id === carlosSelectedProductId && !v.is_archived);
  }, [variants, carlosSelectedProductId]);

  const carlosSelectedVariant = useMemo(() => {
    if (!carlosSelectedVariantId) return null;
    return variants.find((v) => v.id === carlosSelectedVariantId) || null;
  }, [variants, carlosSelectedVariantId]);

  // Produtos filtrados na busca manual de Carlos
  const carlosFilteredProducts = useMemo(() => {
    if (!carlosSearchQuery.trim()) return uniqueProducts;
    const q = carlosSearchQuery.toLowerCase().trim();
    return uniqueProducts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [uniqueProducts, carlosSearchQuery]);

  // ─── CÁLCULO DO RESUMO FINANCEIRO GERAL (TRANSFERÊNCIAS EM ABERTO) ───
  const balanceSummary: StoreBalanceSummary = useMemo(() => {
    let totalBia = 0;
    let totalCarlos = 0;
    let piecesBia = 0;
    let piecesCarlos = 0;
    let openCount = 0;
    let settledCount = 0;

    transfers.forEach((t) => {
      if (!t.isSettled) {
        openCount++;
        const price = t.totalPrice || 0;
        if (t.direction === 'bia_from_carlos') {
          totalBia += price;
          piecesBia += t.quantity;
        } else {
          totalCarlos += price;
          piecesCarlos += t.quantity;
        }
      } else {
        settledCount++;
      }
    });

    const diff = totalBia - totalCarlos;
    let netDebtor: 'Bia' | 'Carlos' | 'Nenhum' = 'Nenhum';
    if (diff > 0.001) netDebtor = 'Bia';
    else if (diff < -0.001) netDebtor = 'Carlos';

    return {
      totalBiaOwesCarlos: Number(totalBia.toFixed(2)),
      totalCarlosOwesBia: Number(totalCarlos.toFixed(2)),
      netAmount: Number(Math.abs(diff).toFixed(2)),
      netDebtor,
      totalPiecesBiaFromCarlos: piecesBia,
      totalPiecesCarlosFromBia: piecesCarlos,
      totalPieces: piecesBia + piecesCarlos,
      openTransfersCount: openCount,
      settledTransfersCount: settledCount,
    };
  }, [transfers]);

  // Contagem de itens com preço pendente no estoque geral
  const pendingPricesCount = useMemo(() => {
    return transfers.filter((t) => !t.isSettled && (t.hasPendingPrice || t.unitPrice === null || t.unitPrice === 0)).length;
  }, [transfers]);

  // ─── LEITOR USB (HOOK CENTRALIZADO) ───
  useBarcodeScanner({
    enabled: isBiaReceiptModalOpen || isCarlosWithdrawalModalOpen,
    onScan: (scannedCode) => {
      if (isBiaReceiptModalOpen) {
        handleProcessBiaScan(scannedCode);
      } else if (isCarlosWithdrawalModalOpen) {
        handleProcessCarlosScan(scannedCode);
      }
    },
  });

  // ─── 1. LÓGICA DE BIPAGEM: BIA PEGOU DE CARLOS (RECEBIMENTO) ───
  const handleProcessBiaScan = (rawCode: string, isManualEntry = false) => {
    const raw = (rawCode || '').trim();
    if (!raw) return;

    const normalized = raw.replace(/;/g, '-');
    const res = resolveScannedBarcode(normalized, variants);

    if (res.success && res.matchedVariant && res.matchedVariant.product) {
      const v = res.matchedVariant;
      const prod = v.product!;
      const qtyToAdd = Math.max(1, Math.floor(Number(biaScanMultiplier) || 1));

      const priceRecord = pricesMap[v.id];
      const hasConfiguredPrice = !!priceRecord && typeof priceRecord.transferPrice === 'number';
      const unitPrice = hasConfiguredPrice ? priceRecord.transferPrice : null;

      setBiaBatchItems((prev) => {
        const existingIndex = prev.findIndex((item) => item.variantId === v.id);
        if (existingIndex >= 0) {
          const updated = [...prev];
          const curr = updated[existingIndex];
          const newQty = curr.quantity + qtyToAdd;
          const currentPrice = curr.hasConfiguredPrice && curr.unitPrice !== null ? curr.unitPrice : 0;
          updated[existingIndex] = {
            ...curr,
            quantity: newQty,
            totalPrice: Number((newQty * currentPrice).toFixed(2)),
          };
          return updated;
        } else {
          const newItem: StoreTransferBatchItem = {
            id: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            variantId: v.id,
            productId: prod.id,
            productName: prod.name,
            sku: prod.sku,
            color: v.color,
            size: v.size,
            barcode: v.barcode || '',
            imagePath: prod.image_path,
            quantity: qtyToAdd,
            unitPrice,
            hasConfiguredPrice,
            totalPrice: hasConfiguredPrice && unitPrice !== null ? Number((qtyToAdd * unitPrice).toFixed(2)) : 0,
            method: isManualEntry ? 'manual' : 'scanner',
          };
          return [newItem, ...prev];
        }
      });

      if (hasConfiguredPrice && unitPrice !== null) {
        setBiaFeedback({
          type: 'success',
          message: `Peça bipada: ${prod.name} (${v.color}/${v.size}) (+${qtyToAdd} un) • R$ ${unitPrice.toFixed(2)}/un`,
        });
      } else {
        setBiaFeedback({
          type: 'error',
          message: `⚠️ ${prod.name} (${v.color}/${v.size}) (+${qtyToAdd} un) bipada, mas com valor pendente (não cadastrado).`,
        });
      }

      setBiaManualBarcodeInput('');
    } else {
      setBiaFeedback({
        type: 'error',
        message: res.errorMessage || `Código não localizado: "${raw}"`,
      });
    }
  };

  // ─── 2. LÓGICA DE RETIRADA: CARLOS PEGOU DE BIA ───
  const handleAddCarlosManualItem = () => {
    if (!carlosSelectedVariant || !carlosSelectedVariant.product) {
      alert('Selecione um produto e a variação desejada.');
      return;
    }

    const v = carlosSelectedVariant;
    const prod = v.product;
    const qtyToAdd = Math.max(1, Math.floor(Number(carlosQuantity) || 1));

    // Validação de saldo no estoque da Bia
    const existingInBatch = carlosBatchItems.find((i) => i.variantId === v.id);
    const alreadyInBatch = existingInBatch ? existingInBatch.quantity : 0;
    const totalRequested = alreadyInBatch + qtyToAdd;

    if (totalRequested > v.stock_quantity) {
      alert(
        `Saldo insuficiente no estoque da Bia!\n\nDisponível: ${v.stock_quantity} un\nJá no lote: ${alreadyInBatch} un\nSolicitado: ${qtyToAdd} un\nTotal solicitado (${totalRequested} un) excede o saldo físico da Bia.`
      );
      return;
    }

    const priceRecord = pricesMap[v.id];
    const hasConfiguredPrice = !!priceRecord && typeof priceRecord.transferPrice === 'number';
    const unitPrice = hasConfiguredPrice ? priceRecord.transferPrice : null;

    setCarlosBatchItems((prev) => {
      const idx = prev.findIndex((item) => item.variantId === v.id);
      if (idx >= 0) {
        const copy = [...prev];
        const curr = copy[idx];
        const newQty = curr.quantity + qtyToAdd;
        const currentPrice = curr.hasConfiguredPrice && curr.unitPrice !== null ? curr.unitPrice : 0;
        copy[idx] = {
          ...curr,
          quantity: newQty,
          currentStock: v.stock_quantity,
          totalPrice: Number((newQty * currentPrice).toFixed(2)),
        };
        return copy;
      } else {
        const newItem: StoreTransferBatchItem = {
          id: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          variantId: v.id,
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          color: v.color,
          size: v.size,
          barcode: v.barcode || '',
          imagePath: prod.image_path,
          quantity: qtyToAdd,
          currentStock: v.stock_quantity,
          unitPrice,
          hasConfiguredPrice,
          totalPrice: hasConfiguredPrice && unitPrice !== null ? Number((qtyToAdd * unitPrice).toFixed(2)) : 0,
          method: 'manual',
        };
        return [newItem, ...prev];
      }
    });

    setCarlosFeedback({
      type: 'success',
      message: `Adicionado: ${prod.name} (${v.color}/${v.size}) • ${qtyToAdd} un adicionada(s) à retirada.`,
    });

    setCarlosQuantity(1);
  };

  // Bipagem Opcional no Modal do Carlos
  const handleProcessCarlosScan = (rawCode: string) => {
    const raw = (rawCode || '').trim();
    if (!raw) return;

    const normalized = raw.replace(/;/g, '-');
    const res = resolveScannedBarcode(normalized, variants);

    if (res.success && res.matchedVariant && res.matchedVariant.product) {
      const v = res.matchedVariant;
      const prod = v.product!;
      const qtyToAdd = 1;

      const existingInBatch = carlosBatchItems.find((i) => i.variantId === v.id);
      const alreadyInBatch = existingInBatch ? existingInBatch.quantity : 0;
      const totalRequested = alreadyInBatch + qtyToAdd;

      if (totalRequested > v.stock_quantity) {
        setCarlosFeedback({
          type: 'error',
          message: `Saldo insuficiente para ${prod.name} (${v.color}/${v.size}). Saldo da Bia: ${v.stock_quantity} un, já no lote: ${alreadyInBatch} un.`,
        });
        return;
      }

      const priceRecord = pricesMap[v.id];
      const hasConfiguredPrice = !!priceRecord && typeof priceRecord.transferPrice === 'number';
      const unitPrice = hasConfiguredPrice ? priceRecord.transferPrice : null;

      setCarlosBatchItems((prev) => {
        const existingIndex = prev.findIndex((item) => item.variantId === v.id);
        if (existingIndex >= 0) {
          const updated = [...prev];
          const curr = updated[existingIndex];
          const newQty = curr.quantity + qtyToAdd;
          const currentPrice = curr.hasConfiguredPrice && curr.unitPrice !== null ? curr.unitPrice : 0;
          updated[existingIndex] = {
            ...curr,
            quantity: newQty,
            currentStock: v.stock_quantity,
            totalPrice: Number((newQty * currentPrice).toFixed(2)),
          };
          return updated;
        } else {
          const newItem: StoreTransferBatchItem = {
            id: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            variantId: v.id,
            productId: prod.id,
            productName: prod.name,
            sku: prod.sku,
            color: v.color,
            size: v.size,
            barcode: v.barcode || '',
            imagePath: prod.image_path,
            quantity: qtyToAdd,
            currentStock: v.stock_quantity,
            unitPrice,
            hasConfiguredPrice,
            totalPrice: hasConfiguredPrice && unitPrice !== null ? Number((qtyToAdd * unitPrice).toFixed(2)) : 0,
            method: 'scanner',
          };
          return [newItem, ...prev];
        }
      });

      setCarlosFeedback({
        type: 'success',
        message: `Bipado com sucesso: ${prod.name} (${v.color}/${v.size}) • +1 un à retirada.`,
      });

      setCarlosManualBarcodeInput('');
    } else {
      setCarlosFeedback({
        type: 'error',
        message: res.errorMessage || `Código não localizado: "${raw}"`,
      });
    }
  };

  // ─── CONFIRMAÇÃO DO RECEBIMENTO: BIA PEGOU DE CARLOS (SEM ALTERAÇÃO DE ESTOQUE) ───
  const handleConfirmBiaReceipt = () => {
    if (biaBatchItems.length === 0) {
      alert('Nenhuma peça foi bipada para o recebimento.');
      return;
    }

    if (isSubmittingBatch) return;
    setIsSubmittingBatch(true);

    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `bia-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const batchId = `bia-batch-${Date.now()}`;
      const nowIso = new Date().toISOString();

      const newRecords: StoreTransferRecord[] = biaBatchItems.map((item, idx) => {
        const unitPrice = item.hasConfiguredPrice && item.unitPrice !== null ? item.unitPrice : null;
        const totalPrice = unitPrice !== null ? Number((item.quantity * unitPrice).toFixed(2)) : 0;

        return {
          id: `trans-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          direction: 'bia_from_carlos',
          originStore: 'Loja do Carlos',
          destinationStore: 'Loja da Bia',
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          variantId: item.variantId,
          color: item.color,
          size: item.size,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
          hasPendingPrice: !item.hasConfiguredPrice || unitPrice === null,
          stockDeducted: false, // REGRA OBRIGATÓRIA: NÃO DEBITA NEM CREDITA ESTOQUE DA BIA
          stockMovementId: null,
          createdAt: nowIso,
          operatorId: user?.id || 'usr-admin-demo',
          operatorName: user?.name || 'Administrador',
          method: item.method,
          isSettled: false,
          batchId,
          idempotencyKey: `${idempotencyKey}-${item.variantId}`,
          imagePath: item.imagePath,
          note: biaBatchNote.trim() || undefined,
        };
      });

      persistTransfers([...newRecords, ...transfers]);

      setBiaBatchItems([]);
      setBiaBatchNote('');
      setIsBiaReceiptModalOpen(false);

      const totalQty = newRecords.reduce((sum, r) => sum + r.quantity, 0);
      const totalVal = newRecords.reduce((sum, r) => sum + r.totalPrice, 0);

      alert(
        `✓ Recebimento registrado com sucesso!\n\n` +
          `Itens recebidos: ${newRecords.length}\n` +
          `Total de peças: ${totalQty} un\n` +
          `Valor financeiro: R$ ${totalVal.toFixed(2)}\n\n` +
          `Nota de Governança: O estoque principal da Bia permaneceu inalterado (registro puramente administrativo e financeiro).`
      );
    } catch (err: unknown) {
      alert(`Falha ao registrar recebimento: ${err instanceof Error ? err.message : 'Erro inesperado'}`);
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  // ─── CONFIRMAÇÃO DA RETIRADA: CARLOS PEGOU DE BIA (BAIXA OFICIAL NO REPOSITORY) ───
  const handleConfirmCarlosWithdrawal = async () => {
    if (carlosBatchItems.length === 0) {
      alert('Nenhuma peça foi selecionada para a retirada.');
      return;
    }

    if (isSubmittingBatch) return;

    // 1. Validação Atômica Preliminar de Saldo Disponível
    for (const item of carlosBatchItems) {
      const currentVariant = variants.find((v) => v.id === item.variantId);
      const availableStock = currentVariant?.stock_quantity ?? 0;
      if (item.quantity > availableStock) {
        alert(
          `Bloqueio de Saldo Insuficiente:\n\nA peça "${item.productName} (${item.color}/${item.size})" possui apenas ${availableStock} un disponível no estoque da Bia, mas foram solicitadas ${item.quantity} un.\n\nAjuste a quantidade antes de prosseguir.`
        );
        return;
      }
    }

    setIsSubmittingBatch(true);
    try {
      const stockRepo = getStockRepository();
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `carlos-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const batchId = `carlos-batch-${Date.now()}`;
      const nowIso = new Date().toISOString();

      const recordedMovements: StockMovement[] = [];
      const newRecords: StoreTransferRecord[] = [];

      // 2. Executa a baixa oficial no IStockRepository para cada peça
      for (const item of carlosBatchItems) {
        const itemKey = `${idempotencyKey}-${item.variantId}`;
        const movRes = await stockRepo.recordMovement({
          variantId: item.variantId,
          movementType: 'exit',
          quantity: item.quantity,
          operatorId: user?.id || 'usr-admin-demo',
          operatorName: user?.name || 'Administrador',
          note: `Acerto entre Lojas: Carlos pegou de Bia (${item.quantity} un)`,
          channel: 'TRANSFERENCIA_LOJAS',
          idempotencyKey: itemKey,
          method: item.method,
        });

        if (!movRes.success) {
          throw new Error(movRes.error || `Falha ao dar baixa no estoque para a peça ${item.barcode}`);
        }

        if (movRes.movement) {
          recordedMovements.push(movRes.movement);
        }

        const unitPrice = item.hasConfiguredPrice && item.unitPrice !== null ? item.unitPrice : null;
        const totalPrice = unitPrice !== null ? Number((item.quantity * unitPrice).toFixed(2)) : 0;

        newRecords.push({
          id: `trans-${Date.now()}-${item.variantId}-${Math.random().toString(36).slice(2, 6)}`,
          direction: 'carlos_from_bia',
          originStore: 'Loja da Bia',
          destinationStore: 'Loja do Carlos',
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          variantId: item.variantId,
          color: item.color,
          size: item.size,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
          hasPendingPrice: !item.hasConfiguredPrice || unitPrice === null,
          stockDeducted: true, // REGRA OBRIGATÓRIA: BAIXA REGISTRADA NO REPOSITORY
          stockMovementId: movRes.movement?.id || null,
          createdAt: nowIso,
          operatorId: user?.id || 'usr-admin-demo',
          operatorName: user?.name || 'Administrador',
          method: item.method,
          isSettled: false,
          batchId,
          idempotencyKey: itemKey,
          imagePath: item.imagePath,
          note: carlosBatchNote.trim() || undefined,
        });
      }

      // 3. Atualiza estado global em memória
      const updatedVariants = await stockRepo.getVariants();
      if (onStockDeducted) {
        onStockDeducted(recordedMovements, updatedVariants as (ProductVariant & { product: Product })[]);
      }

      // 4. Persiste no storage de transferências
      persistTransfers([...newRecords, ...transfers]);

      // 5. Limpa e fecha modal
      setCarlosBatchItems([]);
      setCarlosBatchNote('');
      setCarlosSelectedProductId('');
      setCarlosSelectedVariantId('');
      setIsCarlosWithdrawalModalOpen(false);

      const totalQty = newRecords.reduce((sum, r) => sum + r.quantity, 0);
      const totalVal = newRecords.reduce((sum, r) => sum + r.totalPrice, 0);

      alert(
        `✓ Retirada confirmada com sucesso!\n\n` +
          `Itens retirados: ${newRecords.length}\n` +
          `Total de peças baixadas do estoque da Bia: ${totalQty} un\n` +
          `Valor financeiro gerado: R$ ${totalVal.toFixed(2)}\n\n` +
          `As saídas foram lançadas no histórico oficial de movimentações com atomicidade e idempotência.`
      );
    } catch (err: unknown) {
      alert(`Falha ao registrar retirada: ${err instanceof Error ? err.message : 'Erro inesperado'}`);
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  // ─── FECHAMENTO MENSAL (COMPENSAÇÃO DE SALDOS) ───
  const handleExecuteSettlement = () => {
    if (!isAdmin) {
      alert('Acesso negado: apenas administradores podem executar fechamento mensal.');
      return;
    }

    const openTransfers = transfers.filter((t) => !t.isSettled);
    if (openTransfers.length === 0) {
      alert('Não existem lançamentos abertos para realizar o fechamento.');
      return;
    }

    const totalBia = balanceSummary.totalBiaOwesCarlos;
    const totalCarlos = balanceSummary.totalCarlosOwesBia;
    const compensation = Math.min(totalBia, totalCarlos);
    const net = balanceSummary.netAmount;
    const debtor = balanceSummary.netDebtor;

    const confirmed = window.confirm(
      `Confirmação de Fechamento de Acerto:\n\n` +
        `• Período de Referência: ${settlementMonth}\n` +
        `• Total que Bia deve a Carlos: R$ ${totalBia.toFixed(2)}\n` +
        `• Total que Carlos deve a Bia: R$ ${totalCarlos.toFixed(2)}\n` +
        `• Compensação Automática: R$ ${compensation.toFixed(2)}\n` +
        `• Saldo Líquido Final: ${debtor === 'Nenhum' ? 'R$ 0,00' : `${debtor} deve pagar R$ ${net.toFixed(2)}`}\n\n` +
        `Deseja liquidar ${openTransfers.length} lançamentos em aberto e gerar o comprovante de fechamento?`
    );

    if (!confirmed) return;

    const settlementId = `settle-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const [year, month] = settlementMonth.split('-');
    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];
    const monthLabel = `${monthNames[parseInt(month, 10) - 1]} / ${year}`;

    const newSettlement: MonthlySettlement = {
      id: settlementId,
      monthKey: settlementMonth,
      monthLabel,
      closedAt: nowIso,
      closedBy: user?.id || 'usr-admin-demo',
      closedByName: user?.name || 'Administrador',
      totalBiaOwesCarlos: totalBia,
      totalCarlosOwesBia: totalCarlos,
      compensationAmount: compensation,
      netBalance: net,
      netDebtor: debtor,
      transfersCount: openTransfers.length,
      transferIds: openTransfers.map((t) => t.id),
      status: 'closed',
      note: settlementNote.trim() || undefined,
    };

    const updatedTransfers = transfers.map((t) => {
      if (!t.isSettled) {
        return {
          ...t,
          isSettled: true,
          settlementId,
        };
      }
      return t;
    });

    const updatedSettlements = [newSettlement, ...settlements];

    persistTransfers(updatedTransfers);
    setSettlements(updatedSettlements);
    safeSetStorage(STORAGE_KEY_STORE_SETTLEMENTS, updatedSettlements);

    setIsSettlementModalOpen(false);
    setSettlementNote('');

    alert(
      `✓ Fechamento ${monthLabel} concluído com sucesso!\n\n` +
        `${openTransfers.length} lançamentos liquidados.\n` +
        `Compensação de R$ ${compensation.toFixed(2)} aplicada com sucesso.`
    );
  };

  // ─── SALVAR PREÇO DE REPASSE (TABELA DE PREÇOS) ───
  const handleSavePrice = () => {
    if (!isAdmin) {
      alert('Acesso negado: apenas administradores podem alterar valores de repasse.');
      return;
    }
    if (!editingVariantPrice) return;

    const parsedPrice = parseFloat(priceInputVal.replace(',', '.'));
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setPriceModalError('Informe um valor de repasse numérico válido maior ou igual a zero.');
      return;
    }

    const res = saveStoreTransferPrice({
      variantId: editingVariantPrice.id,
      productId: editingVariantPrice.product_id,
      sku: editingVariantPrice.product.sku,
      barcode: editingVariantPrice.barcode || '',
      productName: editingVariantPrice.product.name,
      variantLabel: `${editingVariantPrice.color} / ${editingVariantPrice.size}`,
      transferPrice: parsedPrice,
      operatorId: user?.id || 'usr-admin-demo',
      operatorName: user?.name || 'Administrador',
      reason: priceReasonVal.trim() || undefined,
    });

    if (!res.success) {
      setPriceModalError(res.error || 'Erro ao gravar preço.');
      return;
    }

    const updatedPrices = getStoreTransferPrices();
    setPricesMap(updatedPrices);

    const updatedLogs = getStoreTransferPriceAuditLogs();
    setPriceAuditLogs(updatedLogs);

    setEditingVariantPrice(null);
    setPriceInputVal('');
    setPriceReasonVal('');
    setPriceModalError('');
  };

  // ─── HISTÓRICOS FILTRADOS POR DIREÇÃO ───
  const biaTransfers = useMemo(() => {
    return transfers
      .filter((t) => t.direction === 'bia_from_carlos')
      .filter((t) => {
        if (biaStatusFilter === 'open' && t.isSettled) return false;
        if (biaStatusFilter === 'settled' && !t.isSettled) return false;
        if (biaSearch.trim()) {
          const q = biaSearch.toLowerCase().trim();
          return (
            t.productName.toLowerCase().includes(q) ||
            t.sku.toLowerCase().includes(q) ||
            t.barcode.toLowerCase().includes(q) ||
            t.operatorName.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [transfers, biaStatusFilter, biaSearch]);

  const carlosTransfers = useMemo(() => {
    return transfers
      .filter((t) => t.direction === 'carlos_from_bia')
      .filter((t) => {
        if (carlosStatusFilter === 'open' && t.isSettled) return false;
        if (carlosStatusFilter === 'settled' && !t.isSettled) return false;
        if (carlosSearch.trim()) {
          const q = carlosSearch.toLowerCase().trim();
          return (
            t.productName.toLowerCase().includes(q) ||
            t.sku.toLowerCase().includes(q) ||
            t.barcode.toLowerCase().includes(q) ||
            t.operatorName.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [transfers, carlosStatusFilter, carlosSearch]);

  return (
    <div className="space-y-6">
      {/* ─── TOPO DO MÓDULO: CABEÇALHO & DASHBOARD ─── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Acerto entre Lojas
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700 border border-blue-200">
              <ArrowLeftRight className="h-3 w-3" /> Bia ↔ Carlos
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Gestão simplificada de transferências e empréstimos entre as lojas com regras automáticas de estoque.
          </p>
        </div>

        {/* Alternador de Abas do Módulo */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => setActiveTabSub('panels')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                activeTabSub === 'panels'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Painéis de Acerto
            </button>
            <button
              onClick={() => setActiveTabSub('prices')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTabSub === 'prices'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Coins className="h-3.5 w-3.5 text-amber-500" />
              Preços das Peças
            </button>
            <button
              onClick={() => setActiveTabSub('settlements')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTabSub === 'settlements'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarCheck className="h-3.5 w-3.5 text-[#166534]" />
              Fechamentos Mensais
            </button>
          </div>

          {isAdmin && (
            <button
              onClick={() => setIsSettlementModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <CalendarCheck className="h-4 w-4" />
              Fechar Mês
            </button>
          )}
        </div>
      </div>

      {/* ─── CARDS DE RESUMO FINANCEIRO (DASHBOARD CORPORATIVO) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Dívida da Bia com Carlos (Identidade Roxa/Azul) */}
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white p-4 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-[#312e81]">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#312e81]">Bia deve a Carlos</span>
            <ArrowDownLeft className="h-4 w-4 text-[#312e81]" />
          </div>
          <div className="text-2xl font-black font-mono text-[#1e1b4b]">
            R$ {balanceSummary.totalBiaOwesCarlos.toFixed(2)}
          </div>
          <p className="text-[11px] text-[#312e81] font-semibold flex items-center gap-1">
            <span>{balanceSummary.totalPiecesBiaFromCarlos} peças recebidas da loja do Carlos</span>
          </p>
        </div>

        {/* Card 2: Dívida do Carlos com Bia (Identidade Verde - Contraste #166534) */}
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white p-4 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-[#166534]">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#166534]">Carlos deve a Bia</span>
            <ArrowUpRight className="h-4 w-4 text-[#166534]" />
          </div>
          <div className="text-2xl font-black font-mono text-[#064e3b]">
            R$ {balanceSummary.totalCarlosOwesBia.toFixed(2)}
          </div>
          <p className="text-[11px] text-[#166534] font-semibold flex items-center gap-1">
            <span>{balanceSummary.totalPiecesCarlosFromBia} peças retiradas do estoque da Bia</span>
          </p>
        </div>

        {/* Card 3: Saldo Líquido Compensado */}
        <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50/80 to-white p-4 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-[#581c87]">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#581c87]">Saldo Líquido</span>
            <ArrowLeftRight className="h-4 w-4 text-[#6b21a8]" />
          </div>
          <div className="text-2xl font-black font-mono text-[#3b0764]">
            R$ {balanceSummary.netAmount.toFixed(2)}
          </div>
          <p className="text-[11px] text-[#581c87] font-bold">
            {balanceSummary.netDebtor === 'Nenhum'
              ? 'Contas equilibradas (R$ 0,00)'
              : `${balanceSummary.netDebtor} deve pagar a diferença`}
          </p>
        </div>

        {/* Card 4: Total de Peças & Status de Preços */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider">Peças em Aberto</span>
            <Package className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">
            {balanceSummary.totalPieces} <span className="text-xs font-bold text-slate-500">un</span>
          </div>
          <p className="text-[11px] text-slate-500">
            {pendingPricesCount > 0 ? (
              <span className="text-amber-700 font-bold flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {pendingPricesCount} peça(s) com valor pendente
              </span>
            ) : (
              <span className="text-[#166534] font-bold flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#166534]" /> Todos os valores definidos
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ─── ABA 1: DOIS PAINÉIS LADO A LADO (LAYOUT REORGANIZADO) ─── */}
      {activeTabSub === 'panels' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ═════════════════════════════════════════════════════════════ */}
          {/* PAINEL ESQUERDO: BIA PEGOU DE CARLOS (RECEBIMENTO)           */}
          {/* Textos escuros sobre fundo claro, contraste alto e 100% legível */}
          {/* ═════════════════════════════════════════════════════════════ */}
          <div className="rounded-2xl border-2 border-indigo-200/90 bg-white shadow-sm overflow-hidden flex flex-col">
            {/* Cabeçalho do Painel da Bia (Fundo claro suave com textos escuros) */}
            <div className="bg-indigo-50 p-5 sm:p-6 border-b border-indigo-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3.5">
                  <div className="h-11 w-11 rounded-xl bg-indigo-700 border border-indigo-800 flex items-center justify-center shrink-0 shadow-sm text-white">
                    <ArrowDownLeft className="h-6 w-6 text-white stroke-[2.5]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-indigo-950 tracking-tight flex items-center gap-2">
                      Bia pegou de Carlos
                    </h3>
                    <p className="text-xs text-indigo-900 font-semibold mt-1">
                      Recebimento de mercadorias da Loja do Carlos (Dívida da Bia)
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsBiaReceiptModalOpen(true);
                    setBiaFeedback({ type: null, message: '' });
                  }}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-indigo-950 font-black text-xs hover:bg-indigo-50 active:scale-95 transition-all shadow-md border-2 border-indigo-600 cursor-pointer shrink-0"
                >
                  <Plus className="h-4 w-4 text-indigo-700 stroke-[3]" />
                  <span>Registrar recebimento</span>
                </button>
              </div>

              {/* Tag informativa de Regra de Estoque */}
              <div className="mt-4 pt-3.5 border-t border-indigo-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-indigo-900">
                <span className="flex items-center gap-2 font-bold">
                  <Info className="h-4 w-4 text-indigo-700 shrink-0" />
                  <span>Regra de estoque: <strong className="text-indigo-950 font-black">Não altera estoque principal da Bia</strong></span>
                </span>
                <span className="font-mono font-black text-indigo-950 text-sm bg-white px-3 py-1 rounded-lg border border-indigo-300 shadow-2xs shrink-0">
                  Total: R$ {balanceSummary.totalBiaOwesCarlos.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Filtros e Busca do Painel da Bia */}
            <div className="p-3.5 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={biaSearch}
                  onChange={(e) => setBiaSearch(e.target.value)}
                  placeholder="Buscar nos recebimentos da Bia..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <select
                value={biaStatusFilter}
                onChange={(e) => setBiaStatusFilter(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">Todos os Status</option>
                <option value="open">Apenas em Aberto</option>
                <option value="settled">Apenas Liquidados</option>
              </select>
            </div>

            {/* Histórico Próprio de Bia pegou de Carlos */}
            <div className="flex-1 overflow-y-auto max-h-[500px] divide-y divide-slate-100">
              {biaTransfers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-1">
                  <Package className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-600">Nenhum recebimento registrado para a Bia</p>
                  <p className="text-[11px] text-slate-400">
                    Clique em "+ Registrar recebimento" para bipar peças recebidas do Carlos.
                  </p>
                </div>
              ) : (
                biaTransfers.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTransferForDetails(t)}
                    className="p-3.5 hover:bg-indigo-50/60 transition-colors cursor-pointer flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                        {t.imagePath ? (
                          <img src={t.imagePath} alt={t.productName} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400">MB</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 truncate">{t.productName}</span>
                          <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1 py-0.2 rounded">
                            {t.color}/{t.size}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span className="font-mono">{t.barcode}</span>
                          <span>•</span>
                          <span>{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-black text-indigo-950 font-mono text-sm">
                          +{t.quantity} un
                        </span>
                        {t.isSettled ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
                            Liquidado
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-950 font-black border border-indigo-300">
                            Aberto
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs">
                        {t.unitPrice !== null && t.unitPrice > 0 ? (
                          <span className="text-slate-800 font-bold">R$ {t.totalPrice.toFixed(2)}</span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                            Valor pendente
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Rodapé do Painel da Bia com Totais */}
            <div className="p-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs text-slate-700">
              <span>{biaTransfers.length} registro(s) listado(s)</span>
              <span className="font-black text-indigo-950 font-mono text-sm">
                Total de peças: {biaTransfers.reduce((a, b) => a + b.quantity, 0)} un
              </span>
            </div>
          </div>

          {/* ═════════════════════════════════════════════════════════════ */}
          {/* PAINEL DIREITO: CARLOS PEGOU DE BIA (RETIRADA COM BAIXA)     */}
          {/* Identidade Verde Elegante: cabeçalho verde claro, textos verde-escuro */}
          {/* ═════════════════════════════════════════════════════════════ */}
          <div className="rounded-2xl border-2 border-emerald-300 bg-white shadow-sm overflow-hidden flex flex-col">
            {/* Cabeçalho do Painel do Carlos (Tema verde claro elegante + textos verde-escuro) */}
            <div className="bg-emerald-50 p-5 sm:p-6 border-b border-emerald-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3.5">
                  <div className="h-11 w-11 rounded-xl bg-emerald-700 border border-emerald-800 flex items-center justify-center shrink-0 shadow-sm text-white">
                    <ArrowUpRight className="h-6 w-6 text-white stroke-[2.5]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-[#064e3b] tracking-tight flex items-center gap-2">
                      Carlos pegou de Bia
                    </h3>
                    <p className="text-xs text-[#166534] font-semibold mt-1">
                      Retirada de mercadorias do Estoque da Bia (Dívida do Carlos)
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsCarlosWithdrawalModalOpen(true);
                    setCarlosFeedback({ type: null, message: '' });
                  }}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#064e3b] font-black text-xs hover:bg-emerald-50 active:scale-95 transition-all shadow-md border-2 border-emerald-600 cursor-pointer shrink-0"
                >
                  <Plus className="h-4 w-4 text-[#166534] stroke-[3]" />
                  <span>Registrar retirada</span>
                </button>
              </div>

              {/* Tag informativa de Regra de Estoque */}
              <div className="mt-4 pt-3.5 border-t border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#166534]">
                <span className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="h-4 w-4 text-[#166534] shrink-0" />
                  <span>Regra de estoque: <strong className="text-[#064e3b] font-black">Baixa automática via Repository</strong></span>
                </span>
                <span className="font-mono font-black text-[#064e3b] text-sm bg-white px-3 py-1 rounded-lg border border-emerald-300 shadow-2xs shrink-0">
                  Total: R$ {balanceSummary.totalCarlosOwesBia.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Filtros e Busca do Painel do Carlos */}
            <div className="p-3.5 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={carlosSearch}
                  onChange={(e) => setCarlosSearch(e.target.value)}
                  placeholder="Buscar nas retiradas do Carlos..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <select
                value={carlosStatusFilter}
                onChange={(e) => setCarlosStatusFilter(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="all">Todos os Status</option>
                <option value="open">Apenas em Aberto</option>
                <option value="settled">Apenas Liquidados</option>
              </select>
            </div>

            {/* Histórico Próprio de Carlos pegou de Bia */}
            <div className="flex-1 overflow-y-auto max-h-[500px] divide-y divide-slate-100">
              {carlosTransfers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-1">
                  <Package className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-600">Nenhuma retirada registrada para o Carlos</p>
                  <p className="text-[11px] text-slate-400">
                    Clique em "+ Registrar retirada" para selecionar peças e efetuar a baixa no estoque.
                  </p>
                </div>
              ) : (
                carlosTransfers.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTransferForDetails(t)}
                    className="p-3.5 hover:bg-emerald-50/60 transition-colors cursor-pointer flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                        {t.imagePath ? (
                          <img src={t.imagePath} alt={t.productName} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400">MB</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 truncate">{t.productName}</span>
                          <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1 py-0.2 rounded">
                            {t.color}/{t.size}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span className="font-mono">{t.barcode}</span>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#166534] font-black bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-300">
                            <Check className="h-3 w-3 text-[#166534] stroke-[2.5]" /> Baixa Estoque
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-black text-[#064e3b] font-mono text-sm">
                          -{t.quantity} un
                        </span>
                        {t.isSettled ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
                            Liquidado
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-[#064e3b] font-black border border-emerald-300">
                            Aberto
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs">
                        {t.unitPrice !== null && t.unitPrice > 0 ? (
                          <span className="text-slate-800 font-bold">R$ {t.totalPrice.toFixed(2)}</span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                            Valor pendente
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Rodapé do Painel do Carlos com Totais */}
            <div className="p-3.5 bg-emerald-50/60 border-t border-emerald-200 flex items-center justify-between text-xs text-[#166534]">
              <span>{carlosTransfers.length} registro(s) listado(s)</span>
              <span className="font-black text-[#064e3b] font-mono text-sm">
                Total de peças: {carlosTransfers.reduce((a, b) => a + b.quantity, 0)} un
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ─── ABA 2: TABELA DE PREÇOS DE REPASSE (HOMOLOGADA) ─── */}
      {activeTabSub === 'prices' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Coins className="h-5 w-5 text-amber-500" />
                Tabela Oficial de Preços de Repasse
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Defina os valores unitários de repasse por variação. O preço é opcional no momento da bipagem, mas garante o cálculo financeiro quando cadastrado.
              </p>
            </div>

            <button
              onClick={() => setIsAuditModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-bold text-xs transition-colors cursor-pointer self-start sm:self-auto"
            >
              <History className="h-3.5 w-3.5 text-slate-500" />
              Trilha de Auditoria ({priceAuditLogs.length})
            </button>
          </div>

          {/* Barra de Busca de Preços */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={priceSearch}
                onChange={(e) => setPriceSearch(e.target.value)}
                placeholder="Pesquisar por produto, SKU ou código de barras..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <select
              value={priceFilterStatus}
              onChange={(e) => setPriceFilterStatus(e.target.value as any)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              <option value="all">Todos os Itens do Estoque</option>
              <option value="priced">Com Preço Cadastrado</option>
              <option value="unpriced">Sem Preço (Pendentes)</option>
            </select>
          </div>

          {/* Lista de Produtos e Variações com Preço */}
          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
            {uniqueProducts
              .filter((p) => {
                if (!priceSearch.trim()) return true;
                const q = priceSearch.toLowerCase().trim();
                const matchesProd = p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
                const matchesVar = variants.some(
                  (v) => v.product_id === p.id && (v.barcode?.toLowerCase().includes(q) || v.color.toLowerCase().includes(q))
                );
                return matchesProd || matchesVar;
              })
              .map((p) => {
                const prodVars = variants.filter((v) => v.product_id === p.id && !v.is_archived);
                const isExpanded = expandedProductIds.has(p.id) || !!priceSearch.trim();

                return (
                  <div key={p.id} className="bg-white">
                    <div
                      onClick={() => {
                        setExpandedProductIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        });
                      }}
                      className="p-3.5 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                          {p.image_path ? (
                            <img src={p.image_path} alt={p.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400">MB</span>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs">{p.name}</span>
                            <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                              {p.sku}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 block mt-0.5">
                            {prodVars.length} variação(ões) disponíveis
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500">
                          {prodVars.filter((v) => pricesMap[v.id]?.transferPrice !== undefined).length}/{prodVars.length} precificados
                        </span>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-slate-50/70 p-3 pt-0 border-t border-slate-100">
                        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100 text-xs">
                          {prodVars.map((v) => {
                            const priceRec = pricesMap[v.id];
                            const hasPrice = !!priceRec && typeof priceRec.transferPrice === 'number';

                            if (priceFilterStatus === 'priced' && !hasPrice) return null;
                            if (priceFilterStatus === 'unpriced' && hasPrice) return null;

                            return (
                              <div key={v.id} className="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/50">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-800">{v.color} • {v.size}</span>
                                  <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 py-0.2 rounded">
                                    {v.barcode}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    (Estoque: {v.stock_quantity} un)
                                  </span>
                                </div>

                                <div className="flex items-center gap-3">
                                  {hasPrice ? (
                                    <span className="font-mono font-bold text-[#166534] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                                      R$ {priceRec.transferPrice.toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                      Sem valor
                                    </span>
                                  )}

                                  {isAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingVariantPrice(v);
                                        setPriceInputVal(hasPrice ? priceRec.transferPrice.toFixed(2) : '');
                                        setPriceReasonVal('');
                                        setPriceModalError('');
                                      }}
                                      className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                                      title="Editar valor de repasse"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  )}
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
          </div>
        </div>
      )}

      {/* ─── ABA 3: FECHAMENTOS MENSAIS ─── */}
      {activeTabSub === 'settlements' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CalendarCheck className="h-5 w-5 text-[#166534]" />
                Histórico de Fechamentos & Liquidações
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Consulte todos os acertos mensais liquidados entre as lojas com compensação e comprovantes.
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {settlements.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Nenhum fechamento mensal executado até o momento.
              </div>
            ) : (
              settlements.map((s) => (
                <div key={s.id} className="p-4 hover:bg-slate-50 transition-colors text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">{s.monthLabel}</span>
                    <span className="text-[11px] font-bold text-[#166534] bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-300">
                      Liquidado em {new Date(s.closedAt).toLocaleDateString('pt-BR')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-600 pt-1">
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Bia devia</span>
                      <span className="font-mono font-bold text-slate-900">R$ {s.totalBiaOwesCarlos.toFixed(2)}</span>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Carlos devia</span>
                      <span className="font-mono font-bold text-slate-900">R$ {s.totalCarlosOwesBia.toFixed(2)}</span>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Compensado</span>
                      <span className="font-mono font-bold text-[#581c87]">R$ {s.compensationAmount.toFixed(2)}</span>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Saldo Final</span>
                      <span className="font-mono font-bold text-[#166534]">
                        {s.netDebtor === 'Nenhum' ? 'R$ 0,00' : `${s.netDebtor} pagou R$ ${s.netBalance.toFixed(2)}`}
                      </span>
                    </div>
                  </div>
                  {s.note && (
                    <p className="text-[11px] text-slate-500 italic mt-1">Obs: {s.note}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: REGISTRAR RECEBIMENTO (BIA PEGOU DE CARLOS)                   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {isBiaReceiptModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 my-8 space-y-4">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-[#312e81] font-bold shrink-0">
                  <ArrowDownLeft className="h-5 w-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Registrar Recebimento — Bia pegou de Carlos
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Bipe os códigos de barras das peças que a Bia está recebendo do Carlos.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsBiaReceiptModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Banner de Regra de Estoque */}
            <div className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-center gap-2">
              <Info className="h-4 w-4 text-[#312e81] shrink-0" />
              <span>
                <strong>Controle Financeiro:</strong> As peças recebidas geram dívida de Bia com Carlos. O estoque principal da Bia <strong>não sofrerá alteração física</strong>.
              </span>
            </div>

            {/* Área de Bipagem USB */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <ScanBarcode className="h-4 w-4 text-[#312e81]" />
                  Bipagem com Leitor USB
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#166534] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#166534]" />
                  Leitor USB Ativo
                </span>
              </div>

              <div className="grid grid-cols-[1fr_120px] gap-2">
                <input
                  ref={biaBarcodeInputRef}
                  type="text"
                  autoFocus
                  value={biaManualBarcodeInput}
                  onChange={(e) => setBiaManualBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleProcessBiaScan(biaManualBarcodeInput, true);
                    }
                  }}
                  placeholder="Bipe ou digite o código de barras (Enter)..."
                  className="w-full px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />

                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-bold text-slate-500">Qtd:</span>
                  <input
                    type="number"
                    min={1}
                    value={biaScanMultiplier}
                    onChange={(e) => setBiaScanMultiplier(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full px-2 py-2 text-xs text-center font-bold font-mono bg-white border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Feedback de Bipagem */}
              {biaFeedback.message && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                    biaFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {biaFeedback.type === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-[#166534] shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                  )}
                  <span>{biaFeedback.message}</span>
                </div>
              )}
            </div>

            {/* Lista das Peças Recebidas no Lote */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  Peças no Lote ({biaBatchItems.reduce((a, b) => a + b.quantity, 0)} un)
                </span>
                {biaBatchItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setBiaBatchItems([])}
                    className="text-[11px] text-rose-600 hover:underline font-semibold cursor-pointer"
                  >
                    Limpar lote
                  </button>
                )}
              </div>

              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white text-xs">
                {biaBatchItems.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">
                    Nenhuma peça bipada ainda. Aponte o leitor USB ou digite o código acima.
                  </div>
                ) : (
                  biaBatchItems.map((item) => (
                    <div key={item.id} className="p-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate">{item.productName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {item.color} • {item.size} • {item.barcode}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono font-bold text-[#1e1b4b] bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                          +{item.quantity} un
                        </span>

                        <div className="text-right font-mono">
                          {item.hasConfiguredPrice && item.unitPrice !== null ? (
                            <span className="font-bold text-slate-800 block">R$ {item.totalPrice.toFixed(2)}</span>
                          ) : (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 block">
                              Valor pendente
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setBiaBatchItems((prev) => prev.filter((i) => i.id !== item.id))}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Observações */}
            <div>
              <input
                type="text"
                value={biaBatchNote}
                onChange={(e) => setBiaBatchNote(e.target.value)}
                placeholder="Observação opcional para este recebimento..."
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none"
              />
            </div>

            {/* Rodapé com Totais e Botão de Confirmação */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <div>
                <span className="text-[11px] text-slate-400 uppercase font-bold block">Total a Pagar ao Carlos</span>
                <span className="text-lg font-black font-mono text-slate-900">
                  R$ {biaBatchItems.reduce((sum, i) => sum + i.totalPrice, 0).toFixed(2)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsBiaReceiptModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={biaBatchItems.length === 0 || isSubmittingBatch}
                  onClick={handleConfirmBiaReceipt}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-[#1e1b4b] hover:bg-[#2e1065] rounded-xl transition-colors shadow-xs disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSubmittingBatch ? 'Confirmando...' : 'Conferir e Confirmar Recebimento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: REGISTRAR RETIRADA (CARLOS PEGOU DE BIA COM BAIXA DE ESTOQUE) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {isCarlosWithdrawalModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 my-8 space-y-4">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center justify-center text-[#166534] font-bold shrink-0">
                  <ArrowUpRight className="h-5 w-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Registrar Retirada — Carlos pegou de Bia
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Selecione as peças que Carlos está retirando. O sistema dará baixa no estoque da Bia.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsCarlosWithdrawalModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Banner de Regra de Estoque */}
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-[#064e3b] flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#166534] shrink-0" />
              <span>
                <strong>Baixa Oficial de Estoque:</strong> Cada peça confirmada será descontada imediatamente do estoque da Bia via Repository, prevenindo saldo negativo.
              </span>
            </div>

            {/* SELEÇÃO MANUAL DE PRODUTO, COR, TAMANHO E QUANTIDADE */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <span className="text-xs font-bold text-slate-800 block">
                1. Seleção Manual da Peça
              </span>

              {/* Busca e Seleção do Produto */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Pesquisar Produto ou SKU:
                  </label>
                  <input
                    type="text"
                    value={carlosSearchQuery}
                    onChange={(e) => setCarlosSearchQuery(e.target.value)}
                    placeholder="Ex.: 0011 ou Calça"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Produto:
                  </label>
                  <select
                    value={carlosSelectedProductId}
                    onChange={(e) => {
                      setCarlosSelectedProductId(e.target.value);
                      setCarlosSelectedVariantId('');
                    }}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Selecione o produto...</option>
                    {carlosFilteredProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Seleção de Variação e Quantidade */}
              {carlosSelectedProductId && (
                <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-[1fr_120px_120px] gap-2 items-end">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Cor e Tamanho:
                    </label>
                    <select
                      value={carlosSelectedVariantId}
                      onChange={(e) => setCarlosSelectedVariantId(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="">Selecione a variação...</option>
                      {carlosProductVariants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.color} • Tam {v.size} (Disp: {v.stock_quantity} un)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Qtd a Retirar:
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={carlosSelectedVariant?.stock_quantity || 1}
                      value={carlosQuantity}
                      onChange={(e) => setCarlosQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full px-2 py-1.5 text-xs text-center font-bold font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <button
                      type="button"
                      disabled={
                        !carlosSelectedVariant ||
                        (carlosSelectedVariant.stock_quantity || 0) <= 0 ||
                        carlosQuantity > (carlosSelectedVariant?.stock_quantity || 0)
                      }
                      onClick={handleAddCarlosManualItem}
                      className="w-full py-2 px-3 bg-[#166534] hover:bg-[#14532d] text-white font-bold text-xs rounded-lg transition-colors shadow-2xs disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"
                    >
                      + Adicionar
                    </button>
                  </div>
                </div>
              )}

              {/* Badge de Saldo em Tempo Real da Variação Selecionada */}
              {carlosSelectedVariant && (
                <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">
                      Saldo Atual no Estoque da Bia:
                    </span>
                    <span
                      className={`font-mono font-black text-sm px-2 py-0.5 rounded ${
                        carlosSelectedVariant.stock_quantity > 0
                          ? 'bg-emerald-50 text-[#166534] border border-emerald-300'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {carlosSelectedVariant.stock_quantity} un
                    </span>
                  </div>

                  {carlosQuantity > carlosSelectedVariant.stock_quantity && (
                    <span className="text-[11px] font-bold text-rose-600">
                      ⚠️ Quantidade solicitada excede o saldo disponível!
                    </span>
                  )}
                </div>
              )}

              {/* BIPAGEM OPCIONAL (COMPATIBILIDADE LEITOR USB) */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setCarlosShowScanner(!carlosShowScanner)}
                  className="text-xs text-[#166534] font-bold flex items-center gap-1 hover:underline cursor-pointer"
                >
                  <ScanBarcode className="h-3.5 w-3.5" />
                  {carlosShowScanner ? 'Ocultar leitor de código de barras' : 'Ou bipe o código de barras com leitor USB'}
                </button>

                {carlosShowScanner && (
                  <div className="mt-2 p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                    <input
                      ref={carlosBarcodeInputRef}
                      type="text"
                      value={carlosManualBarcodeInput}
                      onChange={(e) => setCarlosManualBarcodeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleProcessCarlosScan(carlosManualBarcodeInput);
                        }
                      }}
                      placeholder="Bipe com o leitor USB ou digite o código..."
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Feedback de Carlos */}
              {carlosFeedback.message && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                    carlosFeedback.type === 'success'
                      ? 'bg-emerald-50 text-[#166534] border border-emerald-300'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {carlosFeedback.type === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-[#166534] shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  )}
                  <span>{carlosFeedback.message}</span>
                </div>
              )}
            </div>

            {/* Lista das Peças Selecionadas para Retirada */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  Peças para Retirada ({carlosBatchItems.reduce((a, b) => a + b.quantity, 0)} un)
                </span>
                {carlosBatchItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCarlosBatchItems([])}
                    className="text-[11px] text-rose-600 hover:underline font-semibold cursor-pointer"
                  >
                    Limpar lista
                  </button>
                )}
              </div>

              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white text-xs">
                {carlosBatchItems.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">
                    Nenhuma peça adicionada para a retirada. Selecione ou bipe acima.
                  </div>
                ) : (
                  carlosBatchItems.map((item) => (
                    <div key={item.id} className="p-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate">{item.productName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {item.color} • {item.size} • {item.barcode}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono font-bold text-[#064e3b] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                          -{item.quantity} un
                        </span>

                        <div className="text-right font-mono">
                          {item.hasConfiguredPrice && item.unitPrice !== null ? (
                            <span className="font-bold text-slate-800 block">R$ {item.totalPrice.toFixed(2)}</span>
                          ) : (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 block">
                              Valor pendente
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setCarlosBatchItems((prev) => prev.filter((i) => i.id !== item.id))}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Observações */}
            <div>
              <input
                type="text"
                value={carlosBatchNote}
                onChange={(e) => setCarlosBatchNote(e.target.value)}
                placeholder="Observação opcional para esta retirada..."
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none"
              />
            </div>

            {/* Rodapé com Totais e Confirmação */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <div>
                <span className="text-[11px] text-slate-400 uppercase font-bold block">Total a Receber do Carlos</span>
                <span className="text-lg font-black font-mono text-slate-900">
                  R$ {carlosBatchItems.reduce((sum, i) => sum + i.totalPrice, 0).toFixed(2)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCarlosWithdrawalModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={carlosBatchItems.length === 0 || isSubmittingBatch}
                  onClick={handleConfirmCarlosWithdrawal}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-[#064e3b] hover:bg-[#065f46] rounded-xl transition-colors shadow-xs disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSubmittingBatch ? 'Processando Baixa...' : 'Conferir e Confirmar Retirada'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: FECHAMENTO MENSAL E COMPENSAÇÃO                                 */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {isSettlementModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700 font-bold shrink-0">
                  <CalendarCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Fechamento de Mês</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Compensação mútua e liquidação do acerto.</p>
                </div>
              </div>
              <button onClick={() => setIsSettlementModalOpen(false)} className="p-1 text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">Total que Bia deve a Carlos:</span>
                <span className="font-mono font-bold text-blue-900">R$ {balanceSummary.totalBiaOwesCarlos.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Total que Carlos deve a Bia:</span>
                <span className="font-mono font-bold text-emerald-900">R$ {balanceSummary.totalCarlosOwesBia.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
                <span className="text-slate-900">Compensação Automática:</span>
                <span className="font-mono text-purple-700">
                  R$ {Math.min(balanceSummary.totalBiaOwesCarlos, balanceSummary.totalCarlosOwesBia).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-sm">
                <span className="text-slate-900">Saldo Final Líquido:</span>
                <span className="font-mono text-emerald-700">
                  {balanceSummary.netDebtor === 'Nenhum'
                    ? 'R$ 0,00'
                    : `${balanceSummary.netDebtor} paga R$ ${balanceSummary.netAmount.toFixed(2)}`}
                </span>
              </div>
            </div>

            {pendingPricesCount > 0 && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                ⚠️ Existem {pendingPricesCount} peça(s) com valor pendente. O fechamento considerará os valores já cadastrados.
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Mês de Referência:</label>
              <input
                type="month"
                value={settlementMonth}
                onChange={(e) => setSettlementMonth(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Observações do Fechamento:</label>
              <textarea
                value={settlementNote}
                onChange={(e) => setSettlementNote(e.target.value)}
                placeholder="Ex.: Pago via Pix em 03/11..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                rows={2}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsSettlementModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteSettlement}
                className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer"
              >
                Confirmar Fechamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: EDITAR PREÇO DE REPASSE                                         */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {editingVariantPrice && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Editar Preço de Repasse
            </h3>
            <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg space-y-1">
              <div><strong>Produto:</strong> {editingVariantPrice.product.name}</div>
              <div><strong>Variação:</strong> {editingVariantPrice.color} • {editingVariantPrice.size}</div>
              <div><strong>Código:</strong> {editingVariantPrice.barcode}</div>
            </div>

            {priceModalError && (
              <div className="p-2 bg-rose-50 text-rose-700 border border-rose-200 text-xs rounded-lg">
                {priceModalError}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Novo Preço de Repasse (R$):
              </label>
              <input
                type="text"
                autoFocus
                value={priceInputVal}
                onChange={(e) => setPriceInputVal(e.target.value)}
                placeholder="Ex.: 45.00"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Motivo do Reajuste:
              </label>
              <input
                type="text"
                value={priceReasonVal}
                onChange={(e) => setPriceReasonVal(e.target.value)}
                placeholder="Ex.: Acordo com Carlos"
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-xl"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingVariantPrice(null)}
                className="px-3 py-1.5 text-xs font-bold text-slate-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSavePrice}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer"
              >
                Salvar Preço
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: AUDITORIA DE PREÇOS DE REPASSE                                  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {isAuditModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col space-y-4">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <History className="h-5 w-5 text-slate-700" />
                  Trilha de Auditoria de Preços de Repasse
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Registro cronológico imutável de todas as alterações de preços efetuadas.
                </p>
              </div>
              <button onClick={() => setIsAuditModalOpen(false)} className="p-1 text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 text-xs border border-slate-200 rounded-xl">
              {priceAuditLogs.length === 0 ? (
                <div className="p-8 text-center text-slate-400">Nenhum reajuste registrado ainda.</div>
              ) : (
                priceAuditLogs.map((log) => (
                  <div key={log.id} className="p-3 hover:bg-slate-50">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{log.productName} ({log.variantLabel})</span>
                      <span className="font-mono text-emerald-700 font-bold">
                        {log.previousPrice !== null ? `R$ ${log.previousPrice.toFixed(2)} → ` : ''}R$ {log.newPrice.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-1">
                      <span>Por: {log.changedByName}</span>
                      <span>•</span>
                      <span>{new Date(log.changedAt).toLocaleString('pt-BR')}</span>
                      {log.reason && <span>• Motivo: {log.reason}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: DETALHES DE UM LANÇAMENTO (CONSULTA SEGURA)                     */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {selectedTransferForDetails && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-3">
            <div className="flex items-start justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Detalhes da Movimentação</h3>
              <button onClick={() => setSelectedTransferForDetails(null)} className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700">
              <div>
                <span className="text-slate-400 font-bold uppercase text-[10px] block">Direção</span>
                <span className="font-semibold">
                  {selectedTransferForDetails.direction === 'bia_from_carlos'
                    ? 'Bia pegou de Carlos (Recebimento)'
                    : 'Carlos pegou de Bia (Retirada)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-bold uppercase text-[10px] block">Produto e Variação</span>
                <span className="font-bold text-slate-900">
                  {selectedTransferForDetails.productName} ({selectedTransferForDetails.color} • {selectedTransferForDetails.size})
                </span>
                <div className="font-mono text-slate-500 text-[11px]">{selectedTransferForDetails.barcode}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                <div>
                  <span className="text-slate-400 font-bold uppercase text-[10px] block">Quantidade</span>
                  <span className="font-mono font-bold text-slate-900">{selectedTransferForDetails.quantity} un</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold uppercase text-[10px] block">Valor Financeiro</span>
                  <span className="font-mono font-bold text-slate-900">
                    {selectedTransferForDetails.unitPrice !== null
                      ? `R$ ${selectedTransferForDetails.totalPrice.toFixed(2)}`
                      : 'Valor pendente'}
                  </span>
                </div>
              </div>
              <div className="pt-1 border-t border-slate-100">
                <span className="text-slate-400 font-bold uppercase text-[10px] block">Regra de Estoque Aplicada</span>
                <span className="text-[11px]">
                  {selectedTransferForDetails.direction === 'bia_from_carlos'
                    ? 'Estoque principal da Bia inalterado (controle puramente financeiro).'
                    : `Baixa de ${selectedTransferForDetails.quantity} un confirmada no estoque da Bia (ID: ${selectedTransferForDetails.stockMovementId || 'auditado'}).`}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 pt-1">
                Registrado por {selectedTransferForDetails.operatorName} em{' '}
                {new Date(selectedTransferForDetails.createdAt).toLocaleString('pt-BR')}.
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 text-right">
              <button
                type="button"
                onClick={() => setSelectedTransferForDetails(null)}
                className="px-4 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
