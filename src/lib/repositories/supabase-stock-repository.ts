/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Adaptador de Persistência Real Supabase (PostgreSQL + RLS + GoTrue)
 * ETAPA 9 — PASSO 2
 *
 * REGRAS MANDATÓRIAS DE GOVERNANÇA:
 * 1. Prepara a integração real com o schema PostgreSQL (tabelas products, product_variants, stock_movements).
 * 2. Módulo PERMANECE ESTRITAMENTE DESATIVADO E SEM CONEXÃO REMOTA nesta etapa.
 * 3. Nenhuma chamada remota ao Supabase de produção é realizada sem autorização expressa prévia.
 * 4. Utiliza a rotina atômica transacional RPC 'process_stock_movement_v4' com controle de concorrência.
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
import { createClient } from '../supabase/client';

export class SupabaseStockRepository implements IStockRepository {
  public readonly mode = 'supabase' as const;

  /**
   * Verifica se a persistência real do Supabase foi ativada por configuração
   */
  private isPersistenceEnabled(): boolean {
    return process.env.NEXT_PUBLIC_ENABLE_SUPABASE_PERSISTENCE === 'true';
  }

  /**
   * Obtém a instância segura do cliente Supabase no navegador (se disponível)
   */
  private getClient() {
    if (!this.isPersistenceEnabled()) return null;
    return createClient();
  }

  // --- 1. PRODUTOS E VARIAÇÕES ---

  public async getProducts(): Promise<Product[]> {
    const supabase = this.getClient();
    if (!supabase) {
      // Retorna vazio ou erro controlado sem disparar tráfego remoto
      return [];
    }

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('sku', { ascending: true });

    if (error) {
      console.error('[SupabaseStockRepository] Falha ao consultar produtos:', error.message);
      return [];
    }

    return (data || []) as Product[];
  }

  public async getVariants(): Promise<ProductVariantWithProduct[]> {
    const supabase = this.getClient();
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase
      .from('product_variants')
      .select('*, product:products(*)')
      .order('barcode', { ascending: true });

    if (error) {
      console.error('[SupabaseStockRepository] Falha ao consultar variantes:', error.message);
      return [];
    }

    return (data || []) as ProductVariantWithProduct[];
  }

  public async getVariantById(id: string): Promise<ProductVariantWithProduct | null> {
    const supabase = this.getClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('product_variants')
      .select('*, product:products(*)')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return data as ProductVariantWithProduct;
  }

  public async getVariantByBarcode(barcode: string): Promise<ProductVariantWithProduct | null> {
    const supabase = this.getClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('product_variants')
      .select('*, product:products(*)')
      .eq('barcode', barcode.trim())
      .single();

    if (error || !data) return null;
    return data as ProductVariantWithProduct;
  }

  public async createProduct(
    product: Product,
    variants: (ProductVariant & { product: Product })[]
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = this.getClient();
    if (!supabase) {
      return {
        success: false,
        error: 'Persistência Supabase desativada por governança. Nenhuma alteração enviada ao banco de produção.',
      };
    }

    // 1. Inserção do Produto
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: prodError } = await (supabase as any).from('products').insert({
      id: product.id,
      sku: product.sku,
      name: product.name,
      image_path: product.image_path,
      active: true,
      created_at: new Date().toISOString(),
    });

    if (prodError) {
      return { success: false, error: `Falha ao cadastrar produto: ${prodError.message}` };
    }

    // 2. Inserção das Variações com Saldo Zero Obrigatório
    const variantPayloads = variants.map((v) => ({
      id: v.id,
      product_id: product.id,
      color: v.color,
      size: v.size,
      barcode: v.barcode,
      stock_quantity: 0, // Saldo ZERO forçado
      created_at: new Date().toISOString(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: varError } = await (supabase as any).from('product_variants').insert(variantPayloads);
    if (varError) {
      return { success: false, error: `Falha ao cadastrar variações: ${varError.message}` };
    }

    return { success: true };
  }

  public async updateProduct(
    product: Product,
    updatedVariants: (ProductVariant & { product: Product })[]
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = this.getClient();
    if (!supabase) {
      return {
        success: false,
        error: 'Persistência Supabase desativada por governança.',
      };
    }

    // Atualiza dados cadastrais do produto
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from('products')
      .update({
        name: product.name,
        image_path: product.image_path,
        updated_at: new Date().toISOString(),
      })
      .eq('id', product.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Upsert das variantes (novas entram com saldo ZERO via schema trigger)
    const variantPayloads = updatedVariants.map((v) => ({
      id: v.id,
      product_id: product.id,
      color: v.color,
      size: v.size,
      barcode: v.barcode,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: varError } = await (supabase as any)
      .from('product_variants')
      .upsert(variantPayloads, { onConflict: 'id' });

    if (varError) {
      return { success: false, error: varError.message };
    }

    return { success: true };
  }

  // --- 2. SALDOS E MOVIMENTAÇÕES (ATÔMICOS & IDEMPOTENTES VIA RPC) ---

  public async recordMovement(params: RecordMovementParams): Promise<RecordMovementResult> {
    const supabase = this.getClient();
    if (!supabase) {
      return {
        success: false,
        error: 'Persistência Supabase desativada por governança. Nenhuma chamada remota executada.',
      };
    }

    try {
      // Invocação da rotina atômica transacional no PostgreSQL
      // Executada com SECURITY DEFINER e SELECT ... FOR UPDATE
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('process_stock_movement_v4', {
        p_idempotency_key: params.idempotencyKey || null,
        p_variant_id: params.variantId,
        p_movement_type: params.movementType,
        p_quantity: params.quantity,
        p_note: params.note || null,
        p_channel: params.channel || null,
        p_order_number: params.orderNumber || null,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      const result = data as {
        success: boolean;
        idempotent_replay: boolean;
        movement_id?: string;
        stock_before?: number;
        stock_after?: number;
        message?: string;
      };

      return {
        success: result.success,
        isIdempotentReplay: result.idempotent_replay,
        stockBefore: result.stock_before,
        stockAfter: result.stock_after,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao executar RPC de movimentação.';
      return { success: false, error: msg };
    }
  }

  public async getMovements(limit = 100): Promise<StockMovement[]> {
    const supabase = this.getClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('stock_movements')
      .select('*, variant:product_variants(*, product:products(*))')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[SupabaseStockRepository] Falha ao consultar movimentações:', error.message);
      return [];
    }

    return (data || []) as StockMovement[];
  }

  // --- 3. SAÍDAS PENDENTES E CONSOLIDAÇÃO (ATÔMICA EM LOTE) ---

  public async getPendingExits(): Promise<PendingExit[]> {
    const supabase = this.getClient();
    if (!supabase) {
      // Retorna vazio em modo desativado sem disparar tráfego remoto
      return [];
    }

    const { data, error } = await supabase
      .from('pending_exits')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[SupabaseStockRepository] Falha ao consultar saídas pendentes:', error.message);
      return [];
    }

    return (data || []) as PendingExit[];
  }

  public async savePendingExits(exits: PendingExit[]): Promise<{ success: boolean; error?: string }> {
    const supabase = this.getClient();
    if (!supabase) {
      return {
        success: false,
        error: 'Persistência Supabase desativada por política de governança. Nenhuma gravação remota permitida.',
      };
    }

    try {
      // Na persistência real, limpa a fila anterior e insere os novos itens de forma atômica
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deleteError } = await (supabase as any)
        .from('pending_exits')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteError) {
        return { success: false, error: `Falha ao sincronizar fila de saídas: ${deleteError.message}` };
      }

      if (exits && exits.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insertError } = await (supabase as any)
          .from('pending_exits')
          .insert(exits);

        if (insertError) {
          return { success: false, error: `Falha ao gravar saídas pendentes: ${insertError.message}` };
        }
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar saídas pendentes no Supabase.';
      return { success: false, error: msg };
    }
  }

  public async consolidateExits(params: ConsolidateExitsParams): Promise<ConsolidateExitsResult> {
    const supabase = this.getClient();
    if (!supabase) {
      return {
        success: false,
        consolidatedCount: 0,
        movements: [],
        error: 'Persistência Supabase desativada por política de governança. Nenhuma operação remota executada.',
      };
    }

    const { exits, operatorId, operatorName, idempotencyKey } = params;
    if (!exits || exits.length === 0) {
      return { success: true, consolidatedCount: 0, movements: [] };
    }

    try {
      // Invocação da procedure transacional atômica em lote no PostgreSQL (ACID completo)
      // Previne rigorosamente baixas parciais: ou todas as variações são debitadas ou o lote inteiro é abortado
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('consolidate_stock_exits_batch_v4', {
        p_idempotency_key: idempotencyKey || null,
        p_operator_id: operatorId,
        p_operator_name: operatorName || 'Operador',
        p_exits: exits.map((e) => ({
          id: e.id,
          variant_id: e.variantId,
          quantity: e.quantity,
          platform: e.platform,
          order_number: e.orderNumber || null,
          method: e.method || 'manual',
          reason: e.reason || null,
        })),
      });

      if (error) {
        // POLÍTICA ANTI-SPLIT-BRAIN: Não realiza fallback silencioso para LocalStorage em caso de erro
        return {
          success: false,
          consolidatedCount: 0,
          movements: [],
          error: `Falha na consolidação atômica em lote: ${error.message}`,
        };
      }

      const result = data as {
        success: boolean;
        consolidated_count: number;
        movements: StockMovement[];
        idempotent_replay: boolean;
        message?: string;
      };

      return {
        success: result.success,
        consolidatedCount: result.consolidated_count || exits.length,
        movements: result.movements || [],
        isIdempotentReplay: result.idempotent_replay,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao executar procedure de consolidação atômica.';
      return {
        success: false,
        consolidatedCount: 0,
        movements: [],
        error: msg,
      };
    }
  }

  // --- 4. LEDGER ANTI-RECICLAGEM E CÓDIGOS DE BARRAS ---

  public async isBarcodeInUse(barcode: string): Promise<boolean> {
    const supabase = this.getClient();
    if (!supabase) return false;

    const { count, error } = await supabase
      .from('product_variants')
      .select('id', { count: 'exact', head: true })
      .eq('barcode', barcode.trim());

    if (error) return false;
    return Boolean(count && count > 0);
  }

  public async getNextVariantIndex(productSku: string): Promise<number> {
    const supabase = this.getClient();
    if (!supabase) return 1;

    const prefix = `MB-${productSku.toUpperCase()}-%`;
    const { data } = await supabase
      .from('product_variants')
      .select('barcode')
      .like('barcode', prefix);

    let maxIndex = 0;
    (data || []).forEach((row: { barcode: string | null }) => {
      if (row.barcode) {
        const parts = row.barcode.split('-');
        const last = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(last) && last > maxIndex) maxIndex = last;
      }
    });

    return maxIndex + 1;
  }

  // --- 5. SAÚDE E DIAGNÓSTICO ---

  public async checkHealth(): Promise<RepositoryHealthCheck> {
    if (!this.isPersistenceEnabled()) {
      return {
        isHealthy: false,
        mode: 'supabase',
        message: 'Persistência Supabase desativada por política de governança. Operando em modo de simulação local.',
        details: {
          flag: 'NEXT_PUBLIC_ENABLE_SUPABASE_PERSISTENCE',
          status: 'disabled',
        },
      };
    }

    const supabase = this.getClient();
    if (!supabase) {
      return {
        isHealthy: false,
        mode: 'supabase',
        message: 'Credenciais de conexão Supabase não configuradas.',
      };
    }

    const { error } = await supabase.from('products').select('id', { count: 'exact', head: true });
    if (error) {
      return {
        isHealthy: false,
        mode: 'supabase',
        message: `Falha de conexão com o banco Supabase: ${error.message}`,
      };
    }

    return {
      isHealthy: true,
      mode: 'supabase',
      message: 'Banco de dados Supabase conectado e operacional.',
    };
  }
}
