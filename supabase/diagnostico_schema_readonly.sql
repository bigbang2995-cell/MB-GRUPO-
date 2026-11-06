-- =============================================================================
-- PROJETO: ESTOQUE DIGITAL — MB GRUPO
-- ARQUIVO: supabase/diagnostico_schema_readonly.sql
-- FINALIDADE: Diagnóstico de compatibilidade estrutural e segurança do banco real.
-- TIPO: ESTRITAMENTE DE LEITURA (100% SELECT - NENHUMA ALTERAÇÃO OU ESCRITA)
-- =============================================================================
-- INSTRUÇÕES PARA O ADMINISTRADOR / DBA:
-- 1. Abra o SQL Editor no painel oficial do projeto Supabase.
-- 2. Execute as consultas abaixo em blocos ou integralmente.
-- 3. As consultas leem exclusivamente catálogos de metadados do PostgreSQL
--    (information_schema, pg_catalog) e realizam contagens agregadas (COUNT).
-- 4. NENHUM dado de estoque é modificado, nenhum dado pessoal é exibido e nenhum
--    objeto de banco de dados é criado, alterado ou excluído.
-- =============================================================================

-- =============================================================================
-- PARTE 1: TABELAS, COLUNAS, TIPOS DE DADOS E NULABILIDADE
-- =============================================================================
-- Identifica quais tabelas existem no schema 'public', quais colunas estão presentes,
-- seus tipos de dados reais no PostgreSQL e se aceitam valores nulos (NULL).

SELECT 
  c.table_name AS tabela,
  c.ordinal_position AS pos,
  c.column_name AS coluna,
  c.data_type AS tipo_dado,
  c.udt_name AS tipo_udt,
  c.is_nullable AS aceita_null,
  c.column_default AS valor_padrao
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('products', 'product_variants', 'stock_movements', 'marketplace_skus', 'user_profiles', 'idempotency_records')
ORDER BY c.table_name, c.ordinal_position;

-- =============================================================================
-- PARTE 2: STATUS DE ROW LEVEL SECURITY (RLS) E PROPRIETÁRIOS DAS TABELAS
-- =============================================================================
-- Revela se o RLS está habilitado (true/false), se está forçado para o proprietário,
-- e qual o papel proprietário de cada tabela no PostgreSQL.

SELECT 
  c.relname AS tabela,
  pg_get_userbyid(c.relowner) AS proprietario,
  c.relrowsecurity AS rls_habilitado,
  c.relforcerowsecurity AS rls_forcado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relkind = 'r'
  AND c.relname IN ('products', 'product_variants', 'stock_movements', 'marketplace_skus', 'user_profiles', 'idempotency_records')
ORDER BY c.relname;

-- =============================================================================
-- PARTE 3: POLÍTICAS RLS ATIVAS NO BANCO
-- =============================================================================
-- Lista todas as políticas de segurança ativas, os papéis aos quais se aplicam
-- (ex.: anon, authenticated), o comando (SELECT, INSERT, UPDATE, DELETE, ALL)
-- e as expressões lógicas de controle (USING e WITH CHECK).

SELECT 
  p.tablename AS tabela,
  p.policyname AS nome_politica,
  p.permissive AS tipo_permissivo,
  p.roles AS papeis_alvo,
  p.cmd AS comando_afetado,
  p.qual AS expressao_using,
  p.with_check AS expressao_with_check
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename IN ('products', 'product_variants', 'stock_movements', 'marketplace_skus', 'user_profiles', 'idempotency_records')
ORDER BY p.tablename, p.policyname;

-- =============================================================================
-- PARTE 4: CONSTRAINTS, CHAVES PRIMÁRIAS, ESTRANGEIRAS E REGRAS DE INTEGRIDADE
-- =============================================================================
-- Mapeia chaves primárias, restrições UNIQUE, regras CHECK e chaves estrangeiras,
-- detalhando as regras de integridade referencial (ON DELETE e ON UPDATE).

SELECT 
  c.conrelid::regclass::text AS tabela,
  c.conname AS nome_constraint,
  CASE c.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'c' THEN 'CHECK'
    WHEN 'x' THEN 'EXCLUSION'
    ELSE c.contype::text
  END AS tipo_constraint,
  pg_get_constraintdef(c.oid, true) AS definicao_completa,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE 'N/A'
  END AS regra_on_delete,
  CASE c.confupdtype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE 'N/A'
  END AS regra_on_update
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public'
  AND c.conrelid::regclass::text IN ('products', 'product_variants', 'stock_movements', 'marketplace_skus', 'user_profiles', 'idempotency_records')
ORDER BY tabela, tipo_constraint DESC, c.conname;

-- =============================================================================
-- PARTE 5: ÍNDICES EXISTENTES E UNICIDADE
-- =============================================================================
-- Lista todos os índices criados nas tabelas de domínio, identificando se são
-- únicos e qual a sua expressão exata de indexação.

SELECT 
  i.tablename AS tabela,
  i.indexname AS nome_indice,
  i.indexdef AS ddl_indice
FROM pg_indexes i
WHERE i.schemaname = 'public'
  AND i.tablename IN ('products', 'product_variants', 'stock_movements', 'marketplace_skus', 'user_profiles', 'idempotency_records')
ORDER BY i.tablename, i.indexname;

-- =============================================================================
-- PARTE 6: MATRIZ DE PRIVILÉGIOS (TABELAS E COLUNAS)
-- =============================================================================
-- Identifica exatamente quais permissões de acesso (SELECT, INSERT, UPDATE, DELETE)
-- estão atualmente concedidas para os papéis 'anon', 'authenticated' e 'PUBLIC'.

-- 6.1 Privilégios no nível de Tabela
SELECT 
  tp.table_name AS tabela,
  tp.grantee AS papel_beneficiario,
  string_agg(tp.privilege_type, ', ' ORDER BY tp.privilege_type) AS privilegios_tabela
FROM information_schema.table_privileges tp
WHERE tp.table_schema = 'public'
  AND tp.table_name IN ('products', 'product_variants', 'stock_movements', 'marketplace_skus', 'user_profiles', 'idempotency_records')
  AND tp.grantee IN ('anon', 'authenticated', 'PUBLIC', 'service_role')
GROUP BY tp.table_name, tp.grantee
ORDER BY tp.table_name, tp.grantee;

-- 6.2 Privilégios no nível de Coluna (verificação de stock_quantity)
SELECT 
  cp.table_name AS tabela,
  cp.column_name AS coluna,
  cp.grantee AS papel_beneficiario,
  string_agg(cp.privilege_type, ', ' ORDER BY cp.privilege_type) AS privilegios_coluna
FROM information_schema.column_privileges cp
WHERE cp.table_schema = 'public'
  AND cp.table_name IN ('products', 'product_variants', 'stock_movements', 'marketplace_skus', 'user_profiles', 'idempotency_records')
  AND cp.grantee IN ('anon', 'authenticated', 'PUBLIC')
GROUP BY cp.table_name, cp.column_name, cp.grantee
ORDER BY cp.table_name, cp.column_name, cp.grantee;

-- =============================================================================
-- PARTE 7: FUNÇÕES RPC EXISTENTES, ASSINATURAS E SEGURANÇA
-- =============================================================================
-- Localiza rotinas e funções armazenadas existentes no schema 'public', checando
-- proprietário, se são SECURITY DEFINER e a configuração de search_path.

SELECT 
  p.proname AS nome_funcao,
  pg_get_function_identity_arguments(p.oid) AS argumentos_entrada,
  pg_get_function_result(p.oid) AS tipo_retorno,
  pg_get_userbyid(p.proowner) AS proprietario,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS modelo_seguranca,
  p.proconfig AS search_path_configurado,
  l.lanname AS linguagem
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname IN ('register_barcode_scan', 'adjust_inventory_balance', 'is_admin', 'is_authorized_user', 'enforce_zero_initial_stock')
ORDER BY p.proname;

-- =============================================================================
-- PARTE 8: GATILHOS (TRIGGERS) ATIVOS
-- =============================================================================
-- Revela triggers ativos nas tabelas, informando evento de disparo (BEFORE/AFTER),
-- manipulação (INSERT/UPDATE/DELETE) e a função que é invocada.

SELECT 
  t.event_object_table AS tabela,
  t.trigger_name AS nome_gatilho,
  t.action_timing AS momento_disparo,
  t.event_manipulation AS evento_disparo,
  t.action_statement AS instrucao_executada
FROM information_schema.triggers t
WHERE t.trigger_schema = 'public'
  AND t.event_object_table IN ('products', 'product_variants', 'stock_movements', 'marketplace_skus', 'user_profiles', 'idempotency_records')
ORDER BY t.event_object_table, t.trigger_name;

-- =============================================================================
-- PARTE 9: CONTAGEM DE REGISTROS POR TABELA (AGREGADO SEM DADOS SENSÍVEIS)
-- =============================================================================
-- Contabiliza o volume de registros existente nas 4 tabelas de domínio confirmadas.
-- Permite saber se a base possui dados reais de catálogo ou se está zerada.

SELECT 'products' AS tabela, COUNT(*) AS total_registros FROM public.products
UNION ALL
SELECT 'product_variants', COUNT(*) FROM public.product_variants
UNION ALL
SELECT 'stock_movements', COUNT(*) FROM public.stock_movements
UNION ALL
SELECT 'marketplace_skus', COUNT(*) FROM public.marketplace_skus;

-- =============================================================================
-- PARTE 10: VERIFICAÇÃO PREVENTIVA DE INTEGRIDADE EM PRODUCT_VARIANTS
-- =============================================================================
-- Consulta de diagnóstico para detectar previamente se existem anomalias nos dados:
-- 1. Códigos de barras duplicados
-- 2. Códigos de barras nulos ou em branco
-- 3. Combinações duplicadas de (produto, cor, tamanho)
-- 4. Saldos negativos ou nulos

-- 10.1 Códigos de barras duplicados (apenas contagem)
SELECT 
  TRIM(pv.barcode) AS codigo_barras,
  COUNT(*) AS quantidade_duplicatas
FROM public.product_variants pv
WHERE pv.barcode IS NOT NULL AND TRIM(pv.barcode) != ''
GROUP BY TRIM(pv.barcode)
HAVING COUNT(*) > 1;

-- 10.2 Combinações duplicadas de produto, cor e tamanho (apenas IDs e contagem)
SELECT 
  pv.product_id,
  LOWER(TRIM(pv.color)) AS cor_normalizada,
  UPPER(TRIM(pv.size)) AS tamanho_normalizado,
  COUNT(*) AS quantidade_duplicatas
FROM public.product_variants pv
GROUP BY pv.product_id, LOWER(TRIM(pv.color)), UPPER(TRIM(pv.size))
HAVING COUNT(*) > 1;

-- 10.3 Variantes com código em branco, saldo nulo ou saldo negativo
SELECT 
  COUNT(CASE WHEN pv.barcode IS NULL OR TRIM(pv.barcode) = '' THEN 1 END) AS total_barcodes_vazios,
  COUNT(CASE WHEN pv.stock_quantity IS NULL THEN 1 END) AS total_saldos_nulos,
  COUNT(CASE WHEN pv.stock_quantity < 0 THEN 1 END) AS total_saldos_negativos
FROM public.product_variants pv;

