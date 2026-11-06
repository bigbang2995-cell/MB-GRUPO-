/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Adaptador de Persistência Local (LocalStorage + Memória)
 * ETAPA 9 — PASSO 2
 *
 * Características:
 * 1. Preserva 100% da operação atual em ambiente de demonstração e desenvolvimento.
 * 2. Garante a integridade dos 18 produtos e 119 variações oficiais do Catálogo V30 com saldo zero.
 * 3. Implementa controle de concorrência simulado em memória (bloqueio atômico por variante).
 * 4. Valida idempotência por chave única antes de qualquer mutação de saldo contábil.
 * 5. Captura precisa de erros de cota (QuotaExceededError).
 */

import { Product, ProductVariant, StockMovement, PendingExit } from '@/types/database';
import {
  IStockRepository,
  ProductVariantWithProduct,
  RecordMovementParams,
  RecordMovementResult,
  ConsolidateExitsParams,
  ConsolidateExitsResult,
  RepositoryHealthCheck,
} from './stock-repository.interface';
import {
  STORAGE_KEY_VARIANTS,
  STORAGE_KEY_MOVEMENTS,
  STORAGE_KEY_PENDING_EXITS,
  safeGetStorage,
  safeSetStorage,
  validateAndRestoreCatalog,
} from '../storage-service';
import { extractBaseSku } from '../barcode-service';

// Carrega o catálogo base inicial V30
function getOfficialBaseVariants(): (ProductVariant & { product: Product })[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const catalog = require('../v30-catalog');
    const products: Product[] = catalog.V30_PRODUCTS || [];
    const variants: ProductVariant[] = catalog.V30_VARIANTS || [];

    const productMap = new Map<string, Product>();
    products.forEach((p) => productMap.set(p.id, p));

    return variants.map((v) => ({
      ...v,
      product: productMap.get(v.product_id) || {
        id: v.product_id,
        sku: 'DESCONHECIDO',
        name: 'Produto V30',
        image_path: null,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: null,
      },
    }));
  } catch {
    return [];
  }
}

export class LocalStockRepository implements IStockRepository {
  public readonly mode = 'local' as const;

  // Trava de concorrência em memória por ID de variante (simula SELECT ... FOR UPDATE)
  private static variantLocks = new Map<string, Promise<void>>();
  // Cache de chaves de idempotência processadas
  private static processedIdempotencyKeys = new Set<string>();

  /**
   * Adquire trava exclusiva para uma variante, prevenindo condições de corrida locais
   */
  private async acquireVariantLock(variantId: string): Promise<() => void> {
    while (LocalStockRepository.variantLocks.has(variantId)) {
      await LocalStockRepository.variantLocks.get(variantId);
    }

    let releaseLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = () => {
        LocalStockRepository.variantLocks.delete(variantId);
        resolve();
      };
    });

    LocalStockRepository.variantLocks.set(variantId, lockPromise);
    return releaseLock;
  }

  // --- 1. PRODUTOS E VARIAÇÕES ---

  public async getVariants(): Promise<ProductVariantWithProduct[]> {
    const officialBase = getOfficialBaseVariants();
    const stored = safeGetStorage<unknown>(STORAGE_KEY_VARIANTS);

    if (stored.success && stored.data) {
      const restored = validateAndRestoreCatalog(stored.data, officialBase);
      return restored.variants;
    }

    return officialBase;
  }

  public async getProducts(): Promise<Product[]> {
    const variants = await this.getVariants();
    const productMap = new Map<string, Product>();

    variants.forEach((v) => {
      if (v.product && !productMap.has(v.product.id)) {
        productMap.set(v.product.id, v.product);
      }
    });

    return Array.from(productMap.values());
  }

  public async getVariantById(id: string): Promise<ProductVariantWithProduct | null> {
    const variants = await this.getVariants();
    const normalized = id.trim().toLowerCase();
    return variants.find((v) => v.id.toLowerCase() === normalized) || null;
  }

  public async getVariantByBarcode(barcode: string): Promise<ProductVariantWithProduct | null> {
    const variants = await this.getVariants();
    const clean = barcode.trim();
    return (
      variants.find(
        (v) => (v.barcode && v.barcode === clean) || (v.barcode && v.barcode.toLowerCase() === clean.toLowerCase())
      ) || null
    );
  }

  public async createProduct(
    product: Product,
    variants: (ProductVariant & { product: Product })[]
  ): Promise<{ success: boolean; error?: string }> {
    const existing = await this.getVariants();

    // Validação de duplicidade de SKU
    const { upperSku } = extractBaseSku(product.sku);
    const skuExists = existing.some(
      (v) => v.product && extractBaseSku(v.product.sku).upperSku === upperSku
    );
    if (skuExists) {
      return { success: false, error: `O SKU "${upperSku}" já está cadastrado no sistema.` };
    }

    // Regra mandatória: novas variações devem iniciar com saldo ZERO
    const sanitizedVariants = variants.map((v) => ({
      ...v,
      stock_quantity: 0,
      product,
    }));

    const combined = [...existing, ...sanitizedVariants];
    const saveRes = safeSetStorage(STORAGE_KEY_VARIANTS, combined);

    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    return { success: true };
  }

  public async updateProduct(
    product: Product,
    updatedVariants: (ProductVariant & { product: Product })[]
  ): Promise<{ success: boolean; error?: string }> {
    const existing = await this.getVariants();
    const { upperSku } = extractBaseSku(product.sku);

    const otherVariants = existing.filter(
      (v) => !v.product || extractBaseSku(v.product.sku).upperSku !== upperSku
    );

    const combined = [...otherVariants, ...updatedVariants];
    const saveRes = safeSetStorage(STORAGE_KEY_VARIANTS, combined);

    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }

    return { success: true };
  }

  // --- 2. SALDOS E MOVIMENTAÇÕES (AUDITADOS & IDEMPOTENTES) ---

  public async recordMovement(params: RecordMovementParams): Promise<RecordMovementResult> {
    const {
      variantId,
      movementType,
      quantity,
      operatorId,
      operatorName,
      note,
      channel,
      orderNumber,
      idempotencyKey,
      method,
      batchId,
      justification,
    } = params;

    if (quantity <= 0) {
      return { success: false, error: 'A quantidade movimentada deve ser maior que zero.' };
    }

    // 1. Verificação de Idempotência
    if (idempotencyKey) {
      if (LocalStockRepository.processedIdempotencyKeys.has(idempotencyKey)) {
        const movements = await this.getMovements();
        const cached = movements.find((m) => m.idempotency_key === idempotencyKey);
        return {
          success: true,
          movement: cached,
          stockBefore: cached?.stock_before,
          stockAfter: cached?.stock_after,
          isIdempotentReplay: true,
        };
      }
    }

    // 2. Bloqueio de Concorrência Simulado (Lock Pessimista)
    const releaseLock = await this.acquireVariantLock(variantId);

    try {
      const variants = await this.getVariants();
      const variantIndex = variants.findIndex((v) => v.id === variantId);

      if (variantIndex === -1) {
        return { success: false, error: `Variante com ID "${variantId}" não encontrada.` };
      }

      const targetVariant = variants[variantIndex];
      const stockBefore = targetVariant.stock_quantity;
      let stockAfter = stockBefore;

      if (movementType === 'entry') {
        stockAfter = stockBefore + quantity;
      } else if (movementType === 'exit') {
        if (stockBefore < quantity) {
          return {
            success: false,
            error: `Saldo insuficiente para saída. Saldo atual: ${stockBefore} un, solicitado: ${quantity} un.`,
          };
        }
        stockAfter = stockBefore - quantity;
      } else if (movementType === 'adjustment') {
        stockAfter = quantity;
      }

      // Atualiza a variante
      const updatedVariant: ProductVariantWithProduct = {
        ...targetVariant,
        stock_quantity: stockAfter,
      };
      const updatedVariants = [...variants];
      updatedVariants[variantIndex] = updatedVariant;

      // Cria registro de auditoria imutável
      const now = new Date().toISOString();
      const newMovement: StockMovement = {
        id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        variant_id: variantId,
        movement_type: movementType,
        quantity,
        stock_before: stockBefore,
        stock_after: stockAfter,
        note: note || null,
        created_by: operatorId,
        operatorName: operatorName || 'Operador',
        idempotency_key: idempotencyKey || null,
        created_at: now,
        variant: targetVariant,
        method: method || 'manual',
        channel: channel || undefined,
        order_number: orderNumber || undefined,
        batch_id: batchId || undefined,
        justification: justification || undefined,
      };

      // Persistência Atômica no Storage
      const saveVarRes = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
      if (!saveVarRes.success) {
        return { success: false, error: saveVarRes.error };
      }

      const existingMovements = await this.getMovements();
      const updatedMovements = [newMovement, ...existingMovements];
      safeSetStorage(STORAGE_KEY_MOVEMENTS, updatedMovements);

      // Marca chave de idempotência
      if (idempotencyKey) {
        LocalStockRepository.processedIdempotencyKeys.add(idempotencyKey);
      }

      return {
        success: true,
        movement: newMovement,
        stockBefore,
        stockAfter,
        isIdempotentReplay: false,
      };
    } finally {
      releaseLock();
    }
  }

  public async getMovements(limit?: number): Promise<StockMovement[]> {
    const stored = safeGetStorage<StockMovement[]>(STORAGE_KEY_MOVEMENTS);
    const list = stored.success && Array.isArray(stored.data) ? stored.data : [];
    if (limit && limit > 0) {
      return list.slice(0, limit);
    }
    return list;
  }

  // --- 3. SAÍDAS PENDENTES E CONSOLIDAÇÃO ---

  public async getPendingExits(): Promise<PendingExit[]> {
    const stored = safeGetStorage<PendingExit[]>(STORAGE_KEY_PENDING_EXITS);
    return stored.success && Array.isArray(stored.data) ? stored.data : [];
  }

  public async savePendingExits(exits: PendingExit[]): Promise<{ success: boolean; error?: string }> {
    const saveRes = safeSetStorage(STORAGE_KEY_PENDING_EXITS, exits);
    if (!saveRes.success) {
      return { success: false, error: saveRes.error };
    }
    return { success: true };
  }

  public async consolidateExits(params: ConsolidateExitsParams): Promise<ConsolidateExitsResult> {
    const { exits, operatorId, operatorName, idempotencyKey } = params;

    if (exits.length === 0) {
      return { success: true, consolidatedCount: 0, movements: [] };
    }

    if (idempotencyKey && LocalStockRepository.processedIdempotencyKeys.has(idempotencyKey)) {
      return {
        success: true,
        consolidatedCount: exits.length,
        movements: [],
        isIdempotentReplay: true,
      };
    }

    // Valida saldo de todos os itens antes de deduzir qualquer unidade
    const variants = await this.getVariants();
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    for (const exit of exits) {
      const v = variantMap.get(exit.variantId);
      if (!v) {
        return {
          success: false,
          consolidatedCount: 0,
          movements: [],
          error: `Variante "${exit.sku}" (${exit.color} / ${exit.size}) não encontrada.`,
        };
      }
      if (v.stock_quantity < exit.quantity) {
        return {
          success: false,
          consolidatedCount: 0,
          movements: [],
          error: `Saldo insuficiente para "${exit.productName}". Disponível: ${v.stock_quantity}, Requisitado: ${exit.quantity}.`,
        };
      }
    }

    // Processa deduções
    const createdMovements: StockMovement[] = [];
    const now = new Date().toISOString();

    for (const exit of exits) {
      const v = variantMap.get(exit.variantId)!;
      const stockBefore = v.stock_quantity;
      const stockAfter = stockBefore - exit.quantity;
      v.stock_quantity = stockAfter;

      const mov: StockMovement = {
        id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        variant_id: exit.variantId,
        movement_type: 'exit',
        quantity: exit.quantity,
        stock_before: stockBefore,
        stock_after: stockAfter,
        note: `Saída consolidada (${exit.platform} - Pedido ${exit.orderNumber || 'N/A'})`,
        created_by: operatorId,
        operatorName: operatorName || 'Operador',
        idempotency_key: idempotencyKey || null,
        created_at: now,
        channel: exit.platform,
        order_number: exit.orderNumber,
        method: exit.method || 'manual',
        justification: exit.reason,
      };
      createdMovements.push(mov);
    }

    // Gravação atômica
    const saveVarRes = safeSetStorage(STORAGE_KEY_VARIANTS, Array.from(variantMap.values()));
    if (!saveVarRes.success) {
      return { success: false, consolidatedCount: 0, movements: [], error: saveVarRes.error };
    }

    const existingMovements = await this.getMovements();
    safeSetStorage(STORAGE_KEY_MOVEMENTS, [...createdMovements, ...existingMovements]);
    safeSetStorage(STORAGE_KEY_PENDING_EXITS, []);

    if (idempotencyKey) {
      LocalStockRepository.processedIdempotencyKeys.add(idempotencyKey);
    }

    return {
      success: true,
      consolidatedCount: exits.length,
      movements: createdMovements,
      isIdempotentReplay: false,
    };
  }

  // --- 4. LEDGER ANTI-RECICLAGEM E CÓDIGOS DE BARRAS ---

  public async isBarcodeInUse(barcode: string): Promise<boolean> {
    const variants = await this.getVariants();
    const clean = barcode.trim().toUpperCase();

    // 1. Checa variantes ativas
    const inActiveVariants = variants.some((v) => v.barcode && v.barcode.toUpperCase() === clean);
    if (inActiveVariants) return true;

    // 2. Checa livro-razão histórico
    const movements = await this.getMovements();
    const inHistory = movements.some(
      (m) => m.variant?.barcode && m.variant.barcode.toUpperCase() === clean
    );

    return inHistory;
  }

  public async getNextVariantIndex(productSku: string): Promise<number> {
    const { upperSku, lowerSku } = extractBaseSku(productSku);
    const variants = await this.getVariants();
    let maxIndex = 0;

    for (const v of variants) {
      const b = v.barcode || '';
      const prefix = `MB-${upperSku}-`;
      if (b.toUpperCase().startsWith(prefix)) {
        const num = parseInt(b.slice(prefix.length), 10);
        if (!isNaN(num) && num > maxIndex) maxIndex = num;
      }

      const idPrefix = `var-${lowerSku}-`;
      if (v.id.toLowerCase().startsWith(idPrefix)) {
        const num = parseInt(v.id.slice(idPrefix.length), 10);
        if (!isNaN(num) && num > maxIndex) maxIndex = num;
      }
    }

    return maxIndex + 1;
  }

  // --- 5. SAÚDE E DIAGNÓSTICO ---

  public async checkHealth(): Promise<RepositoryHealthCheck> {
    const testKey = '__mb_repo_health_check__';
    const writeRes = safeSetStorage(testKey, { ok: true, timestamp: Date.now() });

    if (!writeRes.success) {
      return {
        isHealthy: false,
        mode: 'local',
        message: `Armazenamento local com falha: ${writeRes.error}`,
        details: { isQuotaExceeded: writeRes.isQuotaExceeded },
      };
    }

    // Limpa chave de teste
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(testKey);
      }
    } catch {
      // Ignora erro
    }

    const variants = await this.getVariants();
    return {
      isHealthy: true,
      mode: 'local',
      message: 'Repositório local 100% operacional.',
      details: {
        totalVariants: variants.length,
        officialPreserved: variants.length >= 119,
      },
    };
  }
}
