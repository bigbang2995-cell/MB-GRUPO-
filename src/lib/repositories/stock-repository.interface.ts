/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Contrato Oficial da Camada de Persistência (Repository Pattern)
 * ETAPA 9 — PASSO 2
 *
 * Define a interface universal para operações de dados do Estoque Digital,
 * permitindo alternar de forma transparente entre a demonstração local (LocalStorage)
 * e o banco de produção real (Supabase PostgreSQL + RLS).
 */

import { Product, ProductVariant, StockMovement, PendingExit } from '@/types/database';

export type ProductVariantWithProduct = ProductVariant & { product?: Product };

export interface RecordMovementParams {
  variantId: string;
  movementType: 'entry' | 'exit' | 'adjustment';
  quantity: number;
  operatorId: string;
  operatorName?: string;
  note?: string;
  channel?: string;
  orderNumber?: string;
  idempotencyKey?: string;
  method?: 'manual' | 'scanner' | 'mixed';
  batchId?: string;
  justification?: string;
}

export interface RecordMovementResult {
  success: boolean;
  movement?: StockMovement;
  stockBefore?: number;
  stockAfter?: number;
  isIdempotentReplay?: boolean;
  error?: string;
}

export interface ConsolidateExitsParams {
  exits: PendingExit[];
  operatorId: string;
  operatorName?: string;
  idempotencyKey?: string;
}

export interface ConsolidateExitsResult {
  success: boolean;
  consolidatedCount: number;
  movements: StockMovement[];
  isIdempotentReplay?: boolean;
  error?: string;
}

export interface RepositoryHealthCheck {
  isHealthy: boolean;
  mode: 'local' | 'supabase';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Interface Universal de Persistência do Estoque Digital
 */
export interface IStockRepository {
  /**
   * Identifica o modo de persistência ativo
   */
  readonly mode: 'local' | 'supabase';

  // --- 1. PRODUTOS E VARIAÇÕES ---
  getProducts(): Promise<Product[]>;
  getVariants(): Promise<ProductVariantWithProduct[]>;
  getVariantById(id: string): Promise<ProductVariantWithProduct | null>;
  getVariantByBarcode(barcode: string): Promise<ProductVariantWithProduct | null>;
  createProduct(
    product: Product,
    variants: (ProductVariant & { product: Product })[]
  ): Promise<{ success: boolean; error?: string }>;
  updateProduct(
    product: Product,
    updatedVariants: (ProductVariant & { product: Product })[]
  ): Promise<{ success: boolean; error?: string }>;

  // --- 2. SALDOS E MOVIMENTAÇÕES (AUDITADOS & IDEMPOTENTES) ---
  recordMovement(params: RecordMovementParams): Promise<RecordMovementResult>;
  getMovements(limit?: number): Promise<StockMovement[]>;

  // --- 3. SAÍDAS PENDENTES E CONSOLIDAÇÃO ---
  getPendingExits(): Promise<PendingExit[]>;
  savePendingExits(exits: PendingExit[]): Promise<{ success: boolean; error?: string }>;
  consolidateExits(params: ConsolidateExitsParams): Promise<ConsolidateExitsResult>;

  // --- 4. LEDGER ANTI-RECICLAGEM E CÓDIGOS DE BARRAS ---
  isBarcodeInUse(barcode: string): Promise<boolean>;
  getNextVariantIndex(productSku: string): Promise<number>;

  // --- 5. SAÚDE E DIAGNÓSTICO ---
  checkHealth(): Promise<RepositoryHealthCheck>;
}
