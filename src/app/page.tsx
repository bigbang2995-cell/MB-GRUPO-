'use client';

import React, { useState, useEffect } from 'react';
import {
  UserRole,
  BarcodeScanResult,
  ProductVariant,
  Product,
  StockMovement,
  MarketplaceSku,
  BatchScanningSession,
  BatchCommitResult,
} from '@/types/database';
import { V30_VARIANTS } from '@/lib/v30-catalog';
const MOCK_MOVEMENTS: (StockMovement & { variant: ProductVariant & { product: Product }; operatorName: string })[] = [];
const MOCK_MARKETPLACE_SKUS: (MarketplaceSku & { variant: ProductVariant & { product: Product } })[] = [];
import { Sidebar } from '@/components/layout/Sidebar';
import { TopHeader, NotificationItem } from '@/components/layout/TopHeader';
import { DashboardModule } from '@/components/modules/DashboardModule';
import { ScannerModule } from '@/components/modules/ScannerModule';
import { StockModule } from '@/components/modules/StockModule';
import { MovementsModule } from '@/components/modules/MovementsModule';
import { MarketplacesModule } from '@/components/modules/MarketplacesModule';
import { SettingsModule } from '@/components/modules/SettingsModule';
import { LabelsModule } from '@/components/modules/LabelsModule';
import { OutputsModule, PendingExit } from '@/components/modules/OutputsModule';
import { StoreTransfersModule } from '@/components/modules/StoreTransfersModule';
import { resolveScannedBarcode } from '@/lib/barcode-service';
import {
  safeSetStorage,
  safeGetStorage,
  validateAndRestoreCatalog,
  persistConsolidatedExits,
  STORAGE_KEY_VARIANTS,
  STORAGE_KEY_MOVEMENTS,
  STORAGE_KEY_PENDING_EXITS,
} from '@/lib/storage-service';
import { useAuth } from '@/contexts/AuthContext';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { getStockRepository } from '@/lib/repositories';
import { AlertTriangle } from 'lucide-react';

export default function Home() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const currentRole: UserRole = user?.role || 'operator';
  const [activeTab, setActiveTab] = useState('dashboard');
  const [globalSearch, setGlobalSearch] = useState('');
  const [storageAlert, setStorageAlert] = useState<string | null>(null);
  const stockRepo = getStockRepository();

  // Estados locais reativos em memória (sem conexão remota com banco corporativo)
  const [variants, setVariants] = useState<(ProductVariant & { product: Product })[]>(V30_VARIANTS);
  const [movements, setMovements] = useState<(StockMovement & {
    variant: ProductVariant & { product: Product };
    operatorName: string;
  })[]>(MOCK_MOVEMENTS);
  const [marketplaceSkus, setMarketplaceSkus] = useState<(MarketplaceSku & {
    variant: ProductVariant & { product: Product };
  })[]>(MOCK_MARKETPLACE_SKUS);
  // Saídas pendentes de consolidação (compartilhadas entre Dashboard e Módulo de Saídas)
  const [pendingExits, setPendingExits] = useState<PendingExit[]>([]);

  // Carrega estado de estoque persistido no localStorage (sobrevive a F5 preservando alterações confirmadas e novos SKUs - P-01)
  useEffect(() => {
    const varRes = safeGetStorage<unknown>(STORAGE_KEY_VARIANTS);
    if (varRes.success && varRes.data) {
      const restored = validateAndRestoreCatalog(varRes.data, V30_VARIANTS);
      setVariants(restored.variants);
      if (restored.warnings.length > 0) {
        console.warn('[MB_CATALOG_RESTORE_WARNINGS]', restored.warnings);
      }
    } else if (!varRes.success && varRes.error) {
      setStorageAlert(varRes.error);
    }

    const movRes = safeGetStorage<any[]>(STORAGE_KEY_MOVEMENTS);
    if (movRes.success && Array.isArray(movRes.data)) {
      setMovements(movRes.data);
    }

    const exitsRes = safeGetStorage<PendingExit[]>(STORAGE_KEY_PENDING_EXITS);
    if (exitsRes.success && Array.isArray(exitsRes.data)) {
      setPendingExits(exitsRes.data);
    }
  }, []);

  // Executa a regra atômica da bipagem direta leitor USB em memória local
  const handleScanSuccess = (barcode: string, idempotencyKey: string): BarcodeScanResult => {
    if (!idempotencyKey || idempotencyKey.trim() === '') {
      return {
        success: false,
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'A chave de idempotência (UUID) é obrigatória para registrar a movimentação.',
        barcode,
      };
    }

    // Resolução centralizada com suporte a correspondência exata, case-insensitive e normalização ABNT2 (;)
    const resolution = resolveScannedBarcode(barcode, variants);

    if (!resolution.success || !resolution.matchedVariant) {
      return {
        success: false,
        code: (resolution.error as any) || 'NOT_FOUND',
        message: resolution.errorMessage || `Código de barras não cadastrado: ${barcode}`,
        barcode,
      };
    }

    const variant = resolution.matchedVariant;
    const foundIndex = variants.findIndex((v) => v.id === variant.id);

    if (foundIndex === -1) {
      return {
        success: false,
        code: 'NOT_FOUND',
        message: `Variação não encontrada no catálogo ativo: ${barcode}`,
        barcode,
      };
    }

    if (!variant.product?.active) {
      return {
        success: false,
        code: 'INACTIVE_PRODUCT',
        message: `O produto "${variant.product?.name}" está desativado no sistema.`,
        barcode,
      };
    }

    // Verificação de IDEMPOTÊNCIA PERSISTENTE
    const existingMovement = movements.find((m) => m.idempotency_key === idempotencyKey);
    if (existingMovement) {
      if (existingMovement.variant_id !== variant.id) {
        return {
          success: false,
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'Conflito de Idempotência: Esta mesma chave já foi utilizada anteriormente para outro produto.',
          barcode,
        };
      }

      return {
        success: true,
        idempotent_replay: true,
        message: 'Reenvio detectado após timeout de rede: registro original recuperado sem duplicar saldo!',
        variant_id: variant.id,
        product_id: variant.product_id,
        product_name: variant.product?.name,
        product_sku: variant.product?.sku,
        color: variant.color,
        size: variant.size,
        barcode: variant.barcode || barcode,
        stock_before: existingMovement.stock_before,
        stock_after: existingMovement.stock_after,
        movement_id: existingMovement.id,
        operator_id: existingMovement.created_by || undefined,
        operator_name: existingMovement.operatorName,
      };
    }

    const stockBefore = variant.stock_quantity;
    const stockAfter = stockBefore + 1;
    const operatorId = user?.id || (currentRole === 'admin' ? 'usr-admin-demo' : 'usr-operator-demo');
    const operatorName = user?.name || (currentRole === 'admin' ? 'Administrador' : 'Operador');

    const updatedVariants = [...variants];
    updatedVariants[foundIndex] = {
      ...variant,
      stock_quantity: stockAfter,
    };
    setVariants(updatedVariants);
    const saveVarRes = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
    if (!saveVarRes.success) {
      setStorageAlert(saveVarRes.error || 'Falha ao persistir estoque.');
    }

    const newMovement: StockMovement & {
      variant: ProductVariant & { product: Product };
      operatorName: string;
    } = {
      id: `mov-${Date.now()}`,
      variant_id: variant.id,
      movement_type: 'entry',
      quantity: 1,
      stock_before: stockBefore,
      stock_after: stockAfter,
      note: `Bipagem de entrada física - Leitor USB`,
      created_by: operatorId,
      idempotency_key: idempotencyKey,
      operatorName: operatorName,
      created_at: new Date().toISOString(),
      variant: updatedVariants[foundIndex],
    };

    setMovements((prev) => {
      const nextMovs = [newMovement, ...prev];
      const saveMovRes = safeSetStorage(STORAGE_KEY_MOVEMENTS, nextMovs);
      if (!saveMovRes.success) {
        setStorageAlert(saveMovRes.error || 'Falha ao persistir movimentações.');
      }
      return nextMovs;
    });

    return {
      success: true,
      message: 'Entrada registrada com sucesso!',
      variant_id: variant.id,
      product_id: variant.product_id,
      product_name: variant.product?.name,
      product_sku: variant.product?.sku,
      color: variant.color,
      size: variant.size,
      barcode: variant.barcode || barcode,
      image_path: variant.product?.image_path,
      stock_before: stockBefore,
      stock_after: stockAfter,
      movement_id: newMovement.id,
      operator_id: operatorId,
      operator_name: operatorName,
    };
  };

  // Confirmação explícita de Entradas Pendentes do Módulo de Scanner (Bipagem V30)
  const handleConfirmScannerEntries = (
    entries: {
      variantId: string;
      quantity: number;
      barcode: string;
      idempotencyKey: string;
    }[]
  ): { success: boolean; message: string; results: BarcodeScanResult[] } => {
    if (entries.length === 0) {
      return { success: false, message: 'Nenhuma leitura pendente para confirmar.', results: [] };
    }
    const operatorId = user?.id || (currentRole === 'admin' ? 'usr-admin-demo' : 'usr-operator-demo');
    const operatorName = user?.name || (currentRole === 'admin' ? 'Administrador' : 'Operador');
    const updatedVariants = [...variants];
    const newMovements: (StockMovement & {
      variant: ProductVariant & { product: Product };
      operatorName: string;
    })[] = [];
    const results: BarcodeScanResult[] = [];

    entries.forEach((ent) => {
      const idx = updatedVariants.findIndex((v) => v.id === ent.variantId);
      if (idx === -1) return;
      const variant = updatedVariants[idx];
      const stockBefore = variant.stock_quantity;
      const stockAfter = stockBefore + ent.quantity;

      updatedVariants[idx] = {
        ...variant,
        stock_quantity: stockAfter,
      };

      const mov: StockMovement & {
        variant: ProductVariant & { product: Product };
        operatorName: string;
      } = {
        id: `mov-scan-${Date.now()}-${variant.id}`,
        variant_id: variant.id,
        movement_type: 'entry',
        quantity: ent.quantity,
        stock_before: stockBefore,
        stock_after: stockAfter,
        note: `Bipagem de entrada física - Leitor USB (${ent.quantity} un)`,
        created_by: operatorId,
        idempotency_key: ent.idempotencyKey,
        operatorName: operatorName,
        created_at: new Date().toISOString(),
        variant: updatedVariants[idx],
      };
      newMovements.push(mov);

      results.push({
        success: true,
        message: `Entrada de ${ent.quantity}x ${variant.product?.name} confirmada!`,
        variant_id: variant.id,
        product_id: variant.product_id,
        product_name: variant.product?.name,
        product_sku: variant.product?.sku,
        color: variant.color,
        size: variant.size,
        barcode: variant.barcode || ent.barcode,
        image_path: variant.product?.image_path,
        stock_before: stockBefore,
        stock_after: stockAfter,
        movement_id: mov.id,
        operator_id: operatorId,
        operator_name: operatorName,
      });
    });

    setVariants(updatedVariants);
    const saveVar = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
    if (!saveVar.success) setStorageAlert(saveVar.error || null);

    setMovements((prev) => {
      const nextMovs = [...newMovements, ...prev];
      const saveMov = safeSetStorage(STORAGE_KEY_MOVEMENTS, nextMovs);
      if (!saveMov.success) setStorageAlert(saveMov.error || null);
      return nextMovs;
    });

    return {
      success: true,
      message: `${entries.reduce((a, b) => a + b.quantity, 0)} unidade(s) confirmada(s) no estoque com sucesso!`,
      results,
    };
  };

  const [committedBatches, setCommittedBatches] = useState<BatchCommitResult[]>([]);

  // Executa o salvamento atômico de todo o lote com chave de idempotência
  const handleBatchCommit = (
    session: BatchScanningSession,
    forcedIdempotencyKey?: string
  ): BatchCommitResult => {
    const idempotencyKey =
      forcedIdempotencyKey ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

    const existingBatch = committedBatches.find(
      (b) => b.batch_idempotency_key === idempotencyKey
    );
    if (existingBatch) {
      return {
        ...existingBatch,
        idempotent_replay: true,
        message:
          'Reenvio de lote identificado: os saldos deste lote já foram gravados anteriormente sem duplicação.',
      };
    }

    const operatorId = user?.id || (currentRole === 'admin' ? 'usr-admin-demo' : 'usr-operator-demo');
    const operatorName = user?.name || (currentRole === 'admin' ? 'Administrador' : 'Operador');
    let totalItemsCounted = 0;
    let totalQuantity = 0;
    const batchSummaryItems: BatchCommitResult['items'] = [];
    const newMovements: (StockMovement & {
      variant: ProductVariant & { product: Product };
      operatorName: string;
    })[] = [];

    const updatedVariants = [...variants];

    Object.values(session.items).forEach((item) => {
      const idx = updatedVariants.findIndex((v) => v.id === item.variant_id);
      if (idx !== -1) {
        const variant = updatedVariants[idx];
        const qtyToAdd = item.final_quantity;
        const stockBefore = variant.stock_quantity;
        const stockAfter = stockBefore + qtyToAdd;

        totalItemsCounted += item.scanned_quantity;
        totalQuantity += qtyToAdd;

        updatedVariants[idx] = {
          ...variant,
          stock_quantity: stockAfter,
        };

        batchSummaryItems.push({
          variant_id: variant.id,
          color: variant.color,
          size: variant.size,
          barcode: variant.barcode || item.barcode,
          quantity: qtyToAdd,
          stock_before: stockBefore,
          stock_after: stockAfter,
          justification: item.justification,
        });

        if (qtyToAdd > 0) {
          newMovements.push({
            id: `mov-batch-${Date.now()}-${variant.id}`,
            variant_id: variant.id,
            movement_type: 'entry',
            quantity: qtyToAdd,
            stock_before: stockBefore,
            stock_after: stockAfter,
            note: `Bipagem de Lote V30 (${session.product_sku})${
              item.justification ? ` - Justificativa: ${item.justification}` : ''
            }`,
            created_by: operatorId,
            idempotency_key: `${idempotencyKey}:${variant.id}`,
            operatorName: operatorName,
            created_at: new Date().toISOString(),
            variant: updatedVariants[idx],
          });
        }
      }
    });

    setVariants(updatedVariants);
    const saveVar = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
    if (!saveVar.success) setStorageAlert(saveVar.error || null);

    if (newMovements.length > 0) {
      setMovements((prev) => {
        const nextMovs = [...newMovements, ...prev];
        const saveMov = safeSetStorage(STORAGE_KEY_MOVEMENTS, nextMovs);
        if (!saveMov.success) setStorageAlert(saveMov.error || null);
        return nextMovs;
      });
    }

    const result: BatchCommitResult = {
      success: true,
      message: `Lote de ${totalQuantity} peças do produto "${session.product_name}" gravado com sucesso!`,
      batch_id: session.id,
      batch_idempotency_key: idempotencyKey,
      product_id: session.product_id,
      product_name: session.product_name,
      total_items_counted: totalItemsCounted,
      total_quantity: totalQuantity,
      items: batchSummaryItems,
      confirmed_at: new Date().toISOString(),
      operator_name: operatorName,
    };

    setCommittedBatches((prev) => [result, ...prev]);
    return result;
  };

  // Confirmação de Entradas Manuais Diretas do Módulo de Estoque
  const handleConfirmManualEntries = (
    entries: {
      variantId: string;
      quantity: number;
      stockBefore: number;
      stockAfter: number;
      note?: string;
    }[]
  ) => {
    if (entries.length === 0) return;
    const operatorId = user?.id || (currentRole === 'admin' ? 'usr-admin-demo' : 'usr-operator-demo');
    const operatorName = user?.name || (currentRole === 'admin' ? 'Administrador' : 'Operador');
    const updatedVariants = [...variants];
    const newMovements: (StockMovement & {
      variant: ProductVariant & { product: Product };
      operatorName: string;
    })[] = [];

    entries.forEach((ent) => {
      const idx = updatedVariants.findIndex((v) => v.id === ent.variantId);
      if (idx !== -1) {
        const variant = updatedVariants[idx];
        const stockBefore = variant.stock_quantity;
        const stockAfter = stockBefore + ent.quantity;

        updatedVariants[idx] = {
          ...variant,
          stock_quantity: stockAfter,
        };

        newMovements.push({
          id: `mov-manual-entry-${Date.now()}-${variant.id}`,
          variant_id: variant.id,
          movement_type: 'entry',
          quantity: ent.quantity,
          stock_before: stockBefore,
          stock_after: stockAfter,
          note: ent.note || 'Entrada manual direta (V30)',
          created_by: operatorId,
          idempotency_key:
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `idemp-${Date.now()}-${Math.random()}`,
          operatorName: operatorName,
          method: 'manual',
          created_at: new Date().toISOString(),
          variant: updatedVariants[idx],
        });
      }
    });

    setVariants(updatedVariants);
    const saveVar = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
    if (!saveVar.success) setStorageAlert(saveVar.error || null);

    setMovements((prev) => {
      const nextMovs = [...newMovements, ...prev];
      const saveMov = safeSetStorage(STORAGE_KEY_MOVEMENTS, nextMovs);
      if (!saveMov.success) setStorageAlert(saveMov.error || null);
      return nextMovs;
    });
  };

  // Confirmação de Lote de Saídas com Conferência Unificada
  const handleConfirmExitBatch = (exitsToCommit: PendingExit[]) => {
    if (exitsToCommit.length === 0) return;
    const operatorId = user?.id || (currentRole === 'admin' ? 'usr-admin-demo' : 'usr-operator-demo');
    const operatorName = user?.name || (currentRole === 'admin' ? 'Administrador' : 'Operador');
    const updatedVariants = [...variants];
    const newMovements: (StockMovement & {
      variant: ProductVariant & { product: Product };
      operatorName: string;
    })[] = [];

    exitsToCommit.forEach((exit) => {
      const idx = updatedVariants.findIndex((v) => v.id === exit.variantId);
      if (idx !== -1) {
        const variant = updatedVariants[idx];
        const stockBefore = variant.stock_quantity;
        const stockAfter = Math.max(0, stockBefore - exit.quantity);

        updatedVariants[idx] = {
          ...variant,
          stock_quantity: stockAfter,
        };

        newMovements.push({
          id: `mov-exit-${Date.now()}-${exit.id}`,
          variant_id: variant.id,
          movement_type: 'exit',
          quantity: exit.quantity,
          stock_before: stockBefore,
          stock_after: stockAfter,
          note: `Saída (${exit.platform})${exit.orderNumber ? ` • Pedido: ${exit.orderNumber}` : ''}${
            exit.justification ? ` • Justificativa: ${exit.justification}` : ''
          }`,
          created_by: operatorId,
          idempotency_key: `exit-${Date.now()}-${exit.id}`,
          operatorName: operatorName,
          method: exit.method || 'manual',
          channel: exit.platform,
          order_number: exit.orderNumber,
          justification: exit.justification,
          created_at: new Date().toISOString(),
          variant: updatedVariants[idx],
        });
      }
    });

    setVariants(updatedVariants);
    const saveVar = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
    if (!saveVar.success) setStorageAlert(saveVar.error || null);

    setMovements((prev) => {
      const nextMovs = [...newMovements, ...prev];
      const saveMov = safeSetStorage(STORAGE_KEY_MOVEMENTS, nextMovs);
      if (!saveMov.success) setStorageAlert(saveMov.error || null);
      return nextMovs;
    });
    setPendingExits([]);
  };

  // Consolidação de Saídas Pendentes
  const handleConsolidateExits = () => {
    if (pendingExits.length === 0) return;

    const operatorId = user?.id || (currentRole === 'admin' ? 'usr-admin-demo' : 'usr-operator-demo');
    const operatorName = user?.name || (currentRole === 'admin' ? 'Administrador' : 'Operador');
    const updatedVariants = [...variants];
    const newMovements: (StockMovement & {
      variant: ProductVariant & { product: Product };
      operatorName: string;
    })[] = [];

    // Prevenção contra duplicidades de consolidação
    const existingKeys = new Set(movements.map((m) => m.idempotency_key).filter(Boolean));

    pendingExits.forEach((exit) => {
      const exitKey = `exit-consol-${exit.id}`;
      if (existingKeys.has(exitKey)) {
        return;
      }

      const idx = updatedVariants.findIndex((v) => v.id === exit.variantId);
      if (idx !== -1) {
        const variant = updatedVariants[idx];
        const stockBefore = variant.stock_quantity;
        const stockAfter = Math.max(0, stockBefore - exit.quantity);

        updatedVariants[idx] = {
          ...variant,
          stock_quantity: stockAfter,
        };

        newMovements.push({
          id: `mov-exit-${Date.now()}-${exit.id}`,
          variant_id: variant.id,
          movement_type: 'exit',
          quantity: exit.quantity,
          stock_before: stockBefore,
          stock_after: stockAfter,
          note: `Saída (${exit.platform}): ${exit.reason}`,
          created_by: operatorId,
          idempotency_key: exitKey,
          operatorName: operatorName,
          created_at: new Date().toISOString(),
          variant: updatedVariants[idx],
        });
      }
    });

    // Persistência ATÔMICA das variantes e das movimentações (P-03)
    const persistRes = persistConsolidatedExits(updatedVariants, newMovements, movements);
    if (!persistRes.success) {
      setStorageAlert(persistRes.error || 'Falha ao gravar saídas consolidadas no armazenamento.');
      alert(`ERRO: Não foi possível gravar as saídas no armazenamento: ${persistRes.error}\nOperação cancelada para evitar perda de dados.`);
      return;
    }

    // Sincronização com a camada IStockRepository
    stockRepo.consolidateExits({
      exits: pendingExits,
      operatorId,
      operatorName,
      idempotencyKey: `consol-${Date.now()}`,
    }).catch((err) => {
      console.warn('[Repository] Falha ao sincronizar consolidação no repositório:', err);
    });

    setVariants(updatedVariants);
    setMovements((prev) => [...newMovements, ...prev]);
    const count = pendingExits.reduce((acc, e) => acc + e.quantity, 0);
    setPendingExits([]);
    safeSetStorage(STORAGE_KEY_PENDING_EXITS, []);
    setStorageAlert(null);
    alert(`Consolidação concluída com sucesso! ${count} itens baixados do estoque físico e persistidos.`);
  };

  // Adição de Novo SKU em Memória e Storage Imediato (P-02)
  const handleAddVariant = (newVariant: ProductVariant & { product: Product }): { success: boolean; error?: string } => {
    const updatedVariants = [newVariant, ...variants];
    // Sincronização centralizada com a camada IStockRepository
    stockRepo.updateProduct(newVariant.product, updatedVariants).catch((err) => {
      console.warn('[Repository] Falha ao adicionar SKU via repositório:', err);
    });
    const saveRes = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
    if (!saveRes.success) {
      setStorageAlert(saveRes.error || 'Falha ao persistir nova variação no armazenamento');
      return { success: false, error: saveRes.error };
    }
    setVariants(updatedVariants);
    setStorageAlert(null);
    return { success: true };
  };

  // Criação de Novo Produto/SKU com Múltiplas Variações (Passo 5)
  const handleCreateProduct = (
    product: Product,
    newVariants: (ProductVariant & { product: Product })[]
  ): { success: boolean; error?: string } => {
    const updatedVariants = [...newVariants, ...variants];
    // Sincronização centralizada com a camada IStockRepository
    stockRepo.createProduct(product, newVariants).catch((err) => {
      console.warn('[Repository] Falha ao cadastrar produto via repositório:', err);
    });
    const saveRes = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
    if (!saveRes.success) {
      setStorageAlert(saveRes.error || 'Falha ao persistir novo SKU no armazenamento');
      return { success: false, error: saveRes.error };
    }
    setVariants(updatedVariants);
    setStorageAlert(null);
    return { success: true };
  };

  // Edição de Produto e Atualização de Variações (Passo 5)
  const handleUpdateProduct = (
    updatedProduct: Product,
    updatedVariants: (ProductVariant & { product: Product })[]
  ): { success: boolean; error?: string } => {
    // Sincronização centralizada com a camada IStockRepository
    stockRepo.updateProduct(updatedProduct, updatedVariants).catch((err) => {
      console.warn('[Repository] Falha ao atualizar produto via repositório:', err);
    });
    const saveRes = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
    if (!saveRes.success) {
      setStorageAlert(saveRes.error || 'Falha ao atualizar produto no armazenamento');
      return { success: false, error: saveRes.error };
    }
    setVariants(updatedVariants);
    setStorageAlert(null);
    return { success: true };
  };

  // Restauração de Cópia de Segurança
  const handleRestoreBackup = (data: {
    variants?: any[];
    movements?: any[];
    marketplaceSkus?: any[];
    pendingExits?: any[];
  }) => {
    if (Array.isArray(data.variants)) setVariants(data.variants);
    if (Array.isArray(data.movements)) setMovements(data.movements);
    if (Array.isArray(data.marketplaceSkus)) setMarketplaceSkus(data.marketplaceSkus);
    if (Array.isArray(data.pendingExits)) setPendingExits(data.pendingExits);
  };

  // Notificações Dinâmicas Reais baseadas no Estado Local
  const lowStockCount = variants.filter(
    (v) => v.stock_quantity > 0 && v.stock_quantity <= 15
  ).length;
  const pendingCount = pendingExits.reduce((a, b) => a + b.quantity, 0);

  const notifications: NotificationItem[] = [];
  if (storageAlert) {
    notifications.push({
      id: 'notif-storage-error',
      title: 'Aviso de Armazenamento',
      message: storageAlert,
      type: 'warning',
    });
  }
  if (lowStockCount > 0) {
    notifications.push({
      id: 'notif-low-stock',
      title: 'Alerta de Reposição',
      message: `${lowStockCount} produto(s) com estoque crítico (≤ 15 un.).`,
      type: 'warning',
    });
  }
  if (pendingCount > 0) {
    notifications.push({
      id: 'notif-pending-exits',
      title: 'Saídas Pendentes',
      message: `${pendingCount} item(ns) aguardando consolidação operacional.`,
      type: 'info',
    });
  }
  notifications.push({
    id: 'notif-demo-mode',
    title: 'Modo Demonstração Ativo',
    message: 'Dados locais e simulação em memória (sem sincronização com banco corporativo).',
    type: 'info',
  });

  // Tela de carregamento de sessão
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-medium">Carregando Estoque Digital MB Grupo...</p>
        </div>
      </div>
    );
  }

  // Se não autenticado, exige login corporativo individual (ETAPA 8 - PASSO 2)
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f7fb] font-sans text-slate-900 select-none">
      {/* 1. Menu Lateral Esquerdo Oficial MB Grupo */}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} currentRole={currentRole} />

      {/* 2. Área Principal com Barra Superior e Conteúdo */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Barra Superior Oficial */}
        <TopHeader
          currentRole={currentRole}
          searchTerm={globalSearch}
          onSearchChange={setGlobalSearch}
          notifications={notifications}
        />

        {/* Alerta Visual de Armazenamento Local / QuotaExceeded (P-05) */}
        {storageAlert && (
          <div className="mx-6 mt-3 p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between text-amber-900 text-xs font-semibold shadow-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>{storageAlert}</span>
            </div>
            <button
              onClick={() => setStorageAlert(null)}
              className="text-amber-700 hover:text-amber-900 font-bold px-2 py-0.5 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Canvas de Conteúdo com Rolagem Independente */}
        <main className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin scrollbar-thumb-slate-300">
          <div className="max-w-[1600px] mx-auto">
            {activeTab === 'dashboard' && (
              <DashboardModule
                variants={variants}
                movements={movements}
                marketplaceSkus={marketplaceSkus}
                pendingExits={pendingExits}
                onNavigateToStock={() => setActiveTab('stock')}
                onNavigateToScanner={() => setActiveTab('scanner')}
                onNavigateToOutputs={() => setActiveTab('outputs')}
                onNavigateToMovements={() => setActiveTab('movements')}
                onNavigateToSkus={() => setActiveTab('skus')}
                onAddVariant={handleAddVariant}
                onCreateProduct={handleCreateProduct}
                onRestoreBackup={handleRestoreBackup}
                currentRole={currentRole}
              />
            )}

            {activeTab === 'stock' && (
              <StockModule
                variants={variants}
                currentRole={currentRole}
                pendingExits={pendingExits}
                onAddVariant={handleAddVariant}
                onCreateProduct={handleCreateProduct}
                onUpdateProduct={handleUpdateProduct}
                onNavigateToLabels={() => setActiveTab('labels')}
                onCommitBatch={handleBatchCommit}
                onConfirmManualEntries={handleConfirmManualEntries}
              />
            )}

            {activeTab === 'outputs' && (
              <OutputsModule
                variants={variants}
                currentRole={currentRole}
                pendingExits={pendingExits}
                onAddPendingExit={(exit) => setPendingExits((prev) => [exit, ...prev])}
                onRemovePendingExit={(id) =>
                  setPendingExits((prev) => prev.filter((e) => e.id !== id))
                }
                onConsolidateExits={handleConsolidateExits}
                onConfirmExitBatch={handleConfirmExitBatch}
                movements={movements}
              />
            )}

            {activeTab === 'scanner' && (
              <ScannerModule
                variants={variants}
                onScanSuccess={handleScanSuccess}
                onConfirmScannerEntries={handleConfirmScannerEntries}
                currentRole={currentRole}
                onNavigateToLabels={() => setActiveTab('labels')}
              />
            )}

            {activeTab === 'labels' && (
              <LabelsModule
                variants={variants}
                currentRole={currentRole}
                onNavigateToScanner={(barcode) => {
                  setActiveTab('scanner');
                  if (barcode) {
                    setTimeout(() => {
                      handleScanSuccess(barcode, crypto.randomUUID());
                    }, 100);
                  }
                }}
              />
            )}

            {activeTab === 'movements' && (
              <MovementsModule movements={movements} currentRole={currentRole} />
            )}

            {activeTab === 'store-transfers' && (
              <StoreTransfersModule
                variants={variants}
                currentRole={currentRole}
                onStockDeducted={(newMovements, updatedVariants) => {
                  setVariants(updatedVariants);
                  setMovements((prev) => [...(newMovements as any), ...prev]);
                }}
              />
            )}

            {activeTab === 'skus' && (
              <MarketplacesModule
                marketplaceSkus={marketplaceSkus}
                currentRole={currentRole}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsModule
                currentRole={currentRole}
                onRoleChange={() => {}}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
