/**
 * Contratos de Tipagem do Banco de Dados Supabase
 * Sistema: Estoque Digital — MB Grupo
 *
 * Mapeamento estrito correspondente ao SCHEMA REAL do banco de dados:
 * - products (id, sku, name, image_path, active, created_at, updated_at)
 * - product_variants (id, product_id, color, size, barcode, stock_quantity, created_at)
 * - stock_movements (id, variant_id, movement_type ['entry', 'exit', 'adjustment'], quantity, stock_before, stock_after, note, created_by, created_at)
 * - marketplace_skus (id, variant_id, platform, marketplace_sku, created_at)
 * - user_profiles (id, name, role ['admin', 'operator'], created_at)
 */

export type UserRole = 'admin' | 'operator';

export type MovementType = 'entry' | 'exit' | 'adjustment';

export type MarketplacePlatform =
  | 'TIKTOK_SHOP'
  | 'SHOPEE'
  | 'SHEIN'
  | 'MERCADO_LIVRE'
  | string;

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  image_path: string | null;
  active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  color: string;
  size: string;
  barcode: string | null;
  stock_quantity: number;
  created_at: string;
  product?: Product;
  // Metadados de Arquivamento Administrativo (Soft Archival)
  is_archived?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
  archived_by_name?: string | null;
  archived_reason?: string | null;
}

export interface PendingExit {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
  platform: string;
  reason: string;
  createdAt: string;
  method?: 'manual' | 'scanner' | 'mixed';
  orderNumber?: string;
  barcode?: string;
  stockBefore?: number;
  justification?: string;
}

export interface StockMovement {
  id: string;
  variant_id: string;
  movement_type: MovementType;
  quantity: number;
  stock_before: number;
  stock_after: number;
  note: string | null;
  created_by: string | null; // UUID do auth.users (Opção A)
  idempotency_key?: string | null; // Chave persistente para garantia de idempotência real
  created_at: string;
  variant?: ProductVariant;
  operator?: UserProfile | null;
  operatorName?: string;
  method?: 'manual' | 'scanner' | 'mixed';
  channel?: string;
  order_number?: string;
  batch_id?: string;
  justification?: string;
}

export interface MarketplaceSku {
  id: string;
  variant_id: string;
  platform: MarketplacePlatform;
  marketplace_sku: string;
  created_at: string;
  variant?: ProductVariant;
}

/**
 * Resposta da rotina atômica de bipagem
 */
export interface BarcodeScanResult {
  success: boolean;
  message: string;
  variant_id?: string;
  product_id?: string;
  product_name?: string;
  product_sku?: string;
  color?: string;
  size?: string;
  barcode?: string;
  image_path?: string | null;
  stock_before?: number;
  stock_after?: number;
  movement_id?: string;
  operator_id?: string;
  operator_name?: string;
  idempotent_replay?: boolean;
  code?:
    | 'NOT_FOUND'
    | 'INACTIVE_PRODUCT'
    | 'INVALID_QUANTITY'
    | 'UNAUTHORIZED'
    | 'MISSING_IDEMPOTENCY_KEY'
    | 'IDEMPOTENCY_CONFLICT'
    | 'NO_CHANGE'
    | 'DATABASE_ERROR';
}

export interface PendingScanEntry {
  id: string;
  variant_id: string;
  barcode: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  color: string;
  size: string;
  image_path?: string | null;
  stock_current: number;
  quantity: number;
  scanned_at: string;
}

/**
 * Modelos para o Módulo de Bipagem por Lote (V30)
 */
export type BatchSessionStatus = 'active' | 'paused' | 'reviewing' | 'committed';

export interface BatchItemCount {
  variant_id: string;
  barcode: string;
  color: string;
  size: string;
  scanned_quantity: number;
  manual_adjustment: number;
  final_quantity: number;
  justification?: string;
  stock_before: number;
  manual_quantity?: number;
  method?: 'manual' | 'scanner' | 'mixed';
}

export interface BatchScanEvent {
  id: string;
  barcode: string;
  variant_id: string;
  product_id: string;
  product_name: string;
  color: string;
  size: string;
  timestamp: string;
}

export interface BatchScanningSession {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_image_path?: string | null;
  status: BatchSessionStatus;
  started_at: string;
  updated_at: string;
  created_by: string;
  operator_name: string;
  items: Record<string, BatchItemCount>;
  scan_events: BatchScanEvent[];
  notes?: string;
}

export interface BatchCommitResult {
  success: boolean;
  message: string;
  batch_id: string;
  batch_idempotency_key: string;
  product_id: string;
  product_name: string;
  total_items_counted: number;
  total_quantity: number;
  idempotent_replay?: boolean;
  items: Array<{
    variant_id: string;
    color: string;
    size: string;
    barcode: string;
    quantity: number;
    stock_before: number;
    stock_after: number;
    justification?: string;
  }>;
  confirmed_at: string;
  operator_name: string;
  code?: string;
}

/**
 * Definição do Schema para o Supabase Client Genérico: createClient<Database>()
 */
export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: UserProfile;
        Insert: {
          id: string;
          name: string;
          role?: UserRole;
          created_at?: string;
        };
        Update: Partial<{
          name: string;
          role: UserRole;
        }>;
      };
      products: {
        Row: Product;
        Insert: {
          id?: string;
          sku: string;
          name: string;
          image_path?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: Partial<{
          sku: string;
          name: string;
          image_path: string | null;
          active: boolean;
          updated_at: string | null;
        }>;
      };
      product_variants: {
        Row: ProductVariant;
        Insert: {
          id?: string;
          product_id: string;
          color: string;
          size: string;
          barcode?: string | null;
          stock_quantity?: number;
          created_at?: string;
        };
        Update: Partial<{
          product_id: string;
          color: string;
          size: string;
          barcode: string | null;
          stock_quantity: number;
        }>;
      };
      stock_movements: {
        Row: StockMovement;
        Insert: {
          id?: string;
          variant_id: string;
          movement_type: MovementType;
          quantity: number;
          stock_before: number;
          stock_after: number;
          note?: string | null;
          created_by?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
        };
        Update: never; // Imutável por regra de auditoria
      };
      marketplace_skus: {
        Row: MarketplaceSku;
        Insert: {
          id?: string;
          variant_id: string;
          platform: MarketplacePlatform;
          marketplace_sku: string;
          created_at?: string;
        };
        Update: Partial<{
          variant_id: string;
          platform: MarketplacePlatform;
          marketplace_sku: string;
        }>;
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      register_barcode_scan: {
        Args: {
          p_barcode: string;
          p_quantity?: number;
          p_note?: string;
          p_idempotency_key: string; // Obrigatória para garantir idempotência persistente
        };
        Returns: BarcodeScanResult;
      };
      adjust_inventory_balance: {
        Args: {
          p_variant_id: string;
          p_new_quantity: number;
          p_reason: string;
          p_idempotency_key: string; // Obrigatória para garantir idempotência persistente
        };
        Returns: BarcodeScanResult;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
  };
}
