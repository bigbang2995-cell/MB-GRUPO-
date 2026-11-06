/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Cliente Supabase Administrativo Seguro (Server-Side Exclusivo)
 * ETAPA 8 — PASSO 4
 *
 * REGRA MANDATÓRIA DE SEGURANÇA (REQ-2):
 * NUNCA expor credenciais administrativas ou service_role no navegador.
 * Este módulo executa estritamente no runtime do servidor (Node.js).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

/**
 * Instancia o cliente Supabase com Service Role Key para operações administrativas internas.
 * ATENÇÃO: Nunca importar este módulo em Client Components ('use client').
 */
export function createAdminClient(): SupabaseClient<Database> | null {
  // Guarda de execução: aborta imediatamente se invocado no ambiente do navegador
  if (typeof window !== 'undefined') {
    throw new Error(
      'VIOLAÇÃO DE SEGURANÇA: createAdminClient() não pode ser executado no navegador. ' +
      'A service_role key deve permanecer estritamente no servidor.'
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    // Retorna null de forma graciosa em ambiente de desenvolvimento local sem chaves configuradas
    return null;
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

