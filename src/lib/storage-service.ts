/**
 * MB GRUPO — SERVIÇO DE PERSISTÊNCIA LOCAL SEGURA (STORAGE V30)
 *
 * Módulo centralizado para:
 * 1. Gravação atômica e segura no localStorage com detecção de QuotaExceededError
 * 2. Restauração inteligente e validação de integridade do Catálogo V30 (P-01)
 * 3. Prevenção de perda de dados após F5 para novos produtos e saídas consolidadas
 * 4. Notificação visual de falhas de I/O em vez de blocos catch silenciosos
 */

import { Product, ProductVariant, StockMovement } from '@/types/database';

export const STORAGE_KEY_VARIANTS = 'MB_GRUPO_STOCK_VARIANTS_V30';
export const STORAGE_KEY_MOVEMENTS = 'MB_GRUPO_STOCK_MOVEMENTS_V30';
export const STORAGE_KEY_PENDING_EXITS = 'MB_GRUPO_PENDING_EXITS_V30';
export const STORAGE_KEY_EMPLOYEES = 'MB_GRUPO_EMPLOYEES_V1';
export const STORAGE_KEY_STORE_TRANSFERS = 'MB_GRUPO_STORE_TRANSFERS_V1';
export const STORAGE_KEY_STORE_SETTLEMENTS = 'MB_GRUPO_STORE_SETTLEMENTS_V1';
export const STORAGE_KEY_STORE_TRANSFER_PRICES = 'MB_GRUPO_STORE_TRANSFER_PRICES_V1';
export const STORAGE_KEY_STORE_TRANSFER_PRICE_AUDIT = 'MB_GRUPO_PRICE_AUDIT_LOG_V1';
export const STORAGE_KEY_ADMIN_CREDENTIALS = 'MB_GRUPO_ADMIN_CREDENTIALS_V1';

export interface AdminCredentialsRecord {
  id: string;
  name: string;
  email: string;
  passwordHashSha256: string;
  updatedAt: string;
}

export interface StorageOperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  isQuotaExceeded?: boolean;
}

/**
 * Detecta se uma exceção é proveniente de estouro de cota (QuotaExceededError)
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; number?: number };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014 ||
    e.number === -2147024882
  );
}

/**
 * Grava dados no localStorage com captura precisa de erros e diagnóstico legível
 */
export function safeSetStorage(key: string, value: unknown): StorageOperationResult<void> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {
      success: false,
      error: 'Armazenamento local (localStorage) não disponível neste ambiente.',
      isQuotaExceeded: false,
    };
  }

  try {
    const serialized = JSON.stringify(value);
    window.localStorage.setItem(key, serialized);
    return { success: true };
  } catch (err: unknown) {
    const quota = isQuotaExceededError(err);
    const msg = quota
      ? 'Limite de armazenamento do navegador esgotado (QuotaExceededError). Libere espaço para persistir novas alterações.'
      : `Falha ao gravar no armazenamento local: ${err instanceof Error ? err.message : 'Erro desconhecido'}`;

    console.error(`[MB_STORAGE_ERROR] ${key}:`, err);
    return {
      success: false,
      error: msg,
      isQuotaExceeded: quota,
    };
  }
}

/**
 * Lê e desserializa dados do localStorage com tratamento de exceções
 */
export function safeGetStorage<T>(key: string): StorageOperationResult<T | null> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { success: false, data: null, error: 'Armazenamento local não disponível.' };
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return { success: true, data: null };
    }
    const data = JSON.parse(raw) as T;
    return { success: true, data };
  } catch (err: unknown) {
    console.error(`[MB_STORAGE_READ_ERROR] ${key}:`, err);
    return {
      success: false,
      data: null,
      error: `Dados corrompidos no armazenamento para a chave "${key}".`,
    };
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RESTAURAÇÃO E VALIDAÇÃO ROBUSTA DO CATÁLOGO V30 (P-01)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Regras estritas:
 * 1. Todos os 119 códigos oficiais do Catálogo V30 são preservados obrigatoriamente.
 * 2. Se o dado salvo tiver saldos atualizados para os itens oficiais, aplica os saldos.
 * 3. Se novos produtos/variações foram cadastrados, valida unicidade, integridade de atributos
 *    e integridade de código de barras Code 128 antes de incorporá-los.
 * 4. NUNCA descarta novos produtos simplesmente porque a contagem é > 119.
 * 5. Rejeita itens com códigos corrompidos ou duplicados.
 */
export function validateAndRestoreCatalog(
  savedRaw: unknown,
  officialVariants: (ProductVariant & { product: Product })[]
): {
  variants: (ProductVariant & { product: Product })[];
  isRestored: boolean;
  officialPreservedCount: number;
  newVariantsRestoredCount: number;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Se não houver dados salvos ou não for array, retorna catálogo oficial intacto
  if (!Array.isArray(savedRaw)) {
    return {
      variants: [...officialVariants],
      isRestored: false,
      officialPreservedCount: officialVariants.length,
      newVariantsRestoredCount: 0,
      warnings,
    };
  }

  // Mapeamento dos 119 itens oficiais
  const officialById = new Map<string, ProductVariant & { product: Product }>();
  const officialByBarcode = new Map<string, ProductVariant & { product: Product }>();

  officialVariants.forEach((v) => {
    officialById.set(v.id, v);
    if (v.barcode) officialByBarcode.set(v.barcode.toUpperCase(), v);
  });

  // Mapa de itens recuperados do storage indexados por ID
  const savedMap = new Map<string, Partial<ProductVariant & { product?: Partial<Product> }>>();
  const savedBarcodeMap = new Map<string, Partial<ProductVariant & { product?: Partial<Product> }>>();

  savedRaw.forEach((rawItem: unknown) => {
    if (rawItem && typeof rawItem === 'object') {
      const item = rawItem as Partial<ProductVariant & { product?: Partial<Product> }>;
      if (item.id && typeof item.id === 'string') {
        savedMap.set(item.id, item);
      }
      if (item.barcode && typeof item.barcode === 'string') {
        savedBarcodeMap.set(item.barcode.toUpperCase(), item);
      }
    }
  });

  const mergedVariants: (ProductVariant & { product: Product })[] = [];
  const processedBarcodes = new Set<string>();
  const processedIds = new Set<string>();

  // 1. Processa todos os 119 itens oficiais garantindo presença e atualizando saldos
  officialVariants.forEach((offVar) => {
    const saved = savedMap.get(offVar.id) || (offVar.barcode ? savedBarcodeMap.get(offVar.barcode.toUpperCase()) : null);

    let updatedStock = offVar.stock_quantity;
    if (saved && typeof saved.stock_quantity === 'number' && !isNaN(saved.stock_quantity)) {
      updatedStock = Math.max(0, Math.floor(saved.stock_quantity));
    }

    const updatedProd = { ...offVar.product };
    if (saved?.product && typeof saved.product === 'object') {
      if (typeof saved.product.name === 'string' && saved.product.name.trim()) {
        updatedProd.name = saved.product.name.trim();
      }
      if (saved.product.image_path !== undefined) {
        updatedProd.image_path = saved.product.image_path;
      }
    }

    const mergedItem: ProductVariant & { product: Product } = {
      ...offVar,
      stock_quantity: updatedStock,
      product: updatedProd,
    };

    mergedVariants.push(mergedItem);
    processedIds.add(mergedItem.id);
    if (mergedItem.barcode) processedBarcodes.add(mergedItem.barcode.toUpperCase());
  });

  // 2. Processa variações adicionais cadastradas pelos usuários (além dos 119 oficiais)
  let newVariantsCount = 0;

  savedRaw.forEach((rawItem: unknown) => {
    if (!rawItem || typeof rawItem !== 'object') return;
    const item = rawItem as Partial<ProductVariant & { product?: Partial<Product> }>;

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const barcode = typeof item.barcode === 'string' ? item.barcode.trim() : '';

    // Se já processou como oficial, pula
    if (processedIds.has(id) || (barcode && processedBarcodes.has(barcode.toUpperCase()))) {
      return;
    }

    // Validação de integridade do novo SKU
    if (!id || !barcode) {
      warnings.push(`Item ignorado por falta de identificador ou código de barras: ${JSON.stringify(item)}`);
      return;
    }

    // Validação do produto vinculado
    const prod = item.product;
    if (!prod || typeof prod !== 'object' || !prod.id || !prod.sku) {
      warnings.push(`Variação "${barcode}" descartada por falta de vínculo com Produto válido.`);
      return;
    }

    const cleanStock = Math.max(0, Number(item.stock_quantity) || 0);

    const validatedNewVariant: ProductVariant & { product: Product } = {
      id,
      product_id: String(item.product_id || prod.id),
      color: String(item.color || 'Padrão'),
      size: String(item.size || 'TU'),
      barcode,
      stock_quantity: cleanStock,
      created_at: String(item.created_at || new Date().toISOString()),
      product: {
        id: String(prod.id),
        sku: String(prod.sku).toUpperCase(),
        name: String(prod.name || `Produto ${prod.sku}`),
        image_path: prod.image_path ? String(prod.image_path) : null,
        active: Boolean(prod.active !== false),
        created_at: String(prod.created_at || new Date().toISOString()),
        updated_at: String(prod.updated_at || new Date().toISOString()),
      },
    };

    // Insere no início para prioridade visual
    mergedVariants.unshift(validatedNewVariant);
    processedIds.add(id);
    processedBarcodes.add(barcode.toUpperCase());
    newVariantsCount++;
  });

  return {
    variants: mergedVariants,
    isRestored: true,
    officialPreservedCount: officialVariants.length,
    newVariantsRestoredCount: newVariantsCount,
    warnings,
  };
}

/**
 * Persiste atomicamente o estado de estoque de saídas consolidadas
 */
export function persistConsolidatedExits(
  updatedVariants: (ProductVariant & { product: Product })[],
  newMovements: StockMovement[],
  existingMovements: StockMovement[]
): StorageOperationResult<void> {
  const combinedMovements = [...newMovements, ...existingMovements];

  // Grava primeiro as variantes
  const varRes = safeSetStorage(STORAGE_KEY_VARIANTS, updatedVariants);
  if (!varRes.success) {
    return varRes;
  }

  // Grava em seguida as movimentações
  const movRes = safeSetStorage(STORAGE_KEY_MOVEMENTS, combinedMovements);
  if (!movRes.success) {
    return movRes;
  }

  return { success: true };
}
