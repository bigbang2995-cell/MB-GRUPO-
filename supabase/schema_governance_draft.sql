-- =============================================================================
-- PROJETO: ESTOQUE DIGITAL — MB GRUPO
-- ARQUIVO: supabase/schema_governance_draft.sql
-- FINALIDADE: Rascunho técnico de governança, segurança RLS e rotinas atômicas.
-- STATUS: RASCUNHO PARA REVISÃO TÉCNICA (NÃO EXECUTAR NO BANCO SEM APROVAÇÃO)
-- =============================================================================
--
-- REGRAS FUNDAMENTAIS:
-- 1. Toda alteração de estoque (bipagem ou ajuste) é estritamente transacional e atômica.
-- 2. É impossível alterar 'stock_quantity' diretamente via API/PostgREST.
-- 3. A tabela 'stock_movements' é 100% imutável (bloqueio de UPDATE e DELETE).
-- 4. Idempotência garantida via UUID único no banco e lock consultivo (advisory lock).
-- 5. Reenvios com a mesma chave retornam o resultado original sem duplicar saldo.
-- 6. Reutilização indevida da mesma chave com parâmetros ou usuários diferentes é rejeitada.
-- 7. Autoelevação de privilégios em 'user_profiles' é bloqueada via RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SEÇÃO 1: EVOLUÇÃO ESTRUTURAL DE TABELAS EXISTENTES
-- -----------------------------------------------------------------------------

-- Adiciona operador responsável e chave única de idempotência na tabela de movimentações
ALTER TABLE public.stock_movements
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;

-- Criação da tabela persistente de idempotência transacional
CREATE TABLE IF NOT EXISTS public.idempotency_records (
  key UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  params JSONB NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilita RLS e revoga qualquer acesso direto de clientes externos
ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.idempotency_records FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- SEÇÃO 2: PERFIS DE USUÁRIOS E PREVENÇÃO DE AUTOELEVAÇÃO DE PAPÉIS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Usuário autenticado pode ler apenas o próprio perfil
DROP POLICY IF EXISTS "user_profiles_select_own" ON public.user_profiles;
CREATE POLICY "user_profiles_select_own" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Função auxiliar segura para checagem de administrador
-- (Executada como SECURITY DEFINER para evitar recursão infinita de RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Administradores podem visualizar todos os perfis
DROP POLICY IF EXISTS "user_profiles_select_admin" ON public.user_profiles;
CREATE POLICY "user_profiles_select_admin" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Prevenção de autoelevação: somente Administrador pode alterar ou atribuir papéis
DROP POLICY IF EXISTS "user_profiles_update_admin" ON public.user_profiles;
CREATE POLICY "user_profiles_update_admin" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_profiles_insert_admin" ON public.user_profiles;
CREATE POLICY "user_profiles_insert_admin" ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- -----------------------------------------------------------------------------
-- SEÇÃO 3: POLÍTICAS RLS NAS TABELAS DE DOMÍNIO
-- -----------------------------------------------------------------------------

-- A. PRODUCTS (Cadastro de modelos)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_authenticated" ON public.products;
CREATE POLICY "products_select_authenticated" ON public.products
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "products_modify_admin" ON public.products;
CREATE POLICY "products_modify_admin" ON public.products
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- B. PRODUCT_VARIANTS (Variações e saldos)
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_variants_select_authenticated" ON public.product_variants;
CREATE POLICY "product_variants_select_authenticated" ON public.product_variants
  FOR SELECT TO authenticated USING (true);

-- Administrador pode cadastrar e excluir variações
DROP POLICY IF EXISTS "product_variants_insert_admin" ON public.product_variants;
CREATE POLICY "product_variants_insert_admin" ON public.product_variants
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "product_variants_delete_admin" ON public.product_variants;
CREATE POLICY "product_variants_delete_admin" ON public.product_variants
  FOR DELETE TO authenticated USING (public.is_admin());

-- Permite ao administrador atualizar apenas dados cadastrais (cor, tamanho, barcode)
DROP POLICY IF EXISTS "product_variants_update_cadastral_admin" ON public.product_variants;
CREATE POLICY "product_variants_update_cadastral_admin" ON public.product_variants
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- PRIVILÉGIO DECLARATIVO: Revoga permissão de UPDATE em stock_quantity na API
REVOKE UPDATE ON public.product_variants FROM PUBLIC, anon, authenticated;
GRANT UPDATE (color, size, barcode) ON public.product_variants TO authenticated;

-- Camada defensiva secundária: Gatilho que impede alteração direta de saldo fora de RPC autorizada
CREATE OR REPLACE FUNCTION public.protect_stock_quantity_direct_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity AND current_setting('app.authorized_stock_rpc', true) IS NULL THEN
    RAISE EXCEPTION 'Operação bloqueada: A alteração direta de stock_quantity não é permitida. Utilize as RPCs auditadas.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_stock_quantity_update ON public.product_variants;
CREATE TRIGGER trg_protect_stock_quantity_update
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_stock_quantity_direct_update();

-- C. MARKETPLACE_SKUS (Vínculo de canais de venda)
ALTER TABLE public.marketplace_skus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace_skus_select_authenticated" ON public.marketplace_skus;
CREATE POLICY "marketplace_skus_select_authenticated" ON public.marketplace_skus
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "marketplace_skus_modify_admin" ON public.marketplace_skus;
CREATE POLICY "marketplace_skus_modify_admin" ON public.marketplace_skus
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- D. STOCK_MOVEMENTS (Auditoria imutável)
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_select_authenticated" ON public.stock_movements;
CREATE POLICY "stock_movements_select_authenticated" ON public.stock_movements
  FOR SELECT TO authenticated USING (true);

-- Revoga explicitamente inserção, atualização e deleção direta por clientes
REVOKE INSERT, UPDATE, DELETE ON public.stock_movements FROM PUBLIC, anon, authenticated;

-- Gatilho de defesa em profundidade: Bloqueia permanentemente mutações no histórico
CREATE OR REPLACE FUNCTION public.prevent_stock_movement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Operação não permitida: O histórico de movimentações é estritamente imutável.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_stock_movements ON public.stock_movements;
CREATE TRIGGER trg_protect_stock_movements
  BEFORE UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_stock_movement_mutation();

-- -----------------------------------------------------------------------------
-- SEÇÃO 4: ROTINA ATÔMICA DE BIPAGEM COM IDEMPOTÊNCIA PERSISTENTE
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_barcode_scan(
  p_barcode TEXT,
  p_quantity INT,
  p_note TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_user_name TEXT;
  v_variant RECORD;
  v_product RECORD;
  v_new_stock INT;
  v_idemp_record RECORD;
  v_movement_id UUID;
  v_response JSONB;
BEGIN
  -- 1. Validação de Idempotência Obrigatória
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MISSING_IDEMPOTENCY_KEY',
      'message', 'A chave de idempotência (UUID) é obrigatória para operações que alteram o estoque.'
    );
  END IF;

  -- 2. Validação de Autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'message', 'Operação não permitida: Operador não autenticado.'
    );
  END IF;

  -- 3. Lock Consultivo de Transação (Serialização concorrente estrita por chave)
  PERFORM pg_advisory_xact_lock(hashtext('idemp_' || p_idempotency_key::text));

  -- 4. Verificação de Idempotência Persistente
  SELECT ir.user_id, ir.action, ir.params, ir.response 
  INTO v_idemp_record 
  FROM public.idempotency_records ir 
  WHERE ir.key = p_idempotency_key;

  IF FOUND THEN
    -- Validação de reuso indevido da mesma chave
    IF v_idemp_record.user_id != v_user_id OR 
       v_idemp_record.action != 'barcode_scan' OR 
       (v_idemp_record.params->>'barcode') != TRIM(p_barcode) OR
       (v_idemp_record.params->>'quantity')::int != p_quantity THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'message', 'Conflito de Idempotência: Esta chave já foi utilizada para outra operação, produto ou operador.'
      );
    END IF;

    -- Reenvio legítimo após timeout: devolve resposta original sem novo incremento
    RETURN v_idemp_record.response || jsonb_build_object('idempotent_replay', true);
  END IF;

  -- 5. Validação de Perfil Autorizado
  SELECT up.name INTO v_user_name 
  FROM public.user_profiles up 
  WHERE up.id = v_user_id AND up.role IN ('admin', 'operator');

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'message', 'Acesso negado: Perfil de operador não autorizado no sistema.'
    );
  END IF;

  -- 6. Validação da Quantidade
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 1000 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_QUANTITY',
      'message', 'Quantidade inválida: O valor deve ser um número inteiro positivo entre 1 e 1000.'
    );
  END IF;

  -- 7. Lock Exclusivo de Linha (FOR UPDATE) com colunas qualificadas
  SELECT pv.id, pv.product_id, pv.color, pv.size, pv.barcode, pv.stock_quantity
  INTO v_variant
  FROM public.product_variants pv
  WHERE pv.barcode = TRIM(p_barcode)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'message', 'Código de barras não cadastrado: ' || TRIM(p_barcode)
    );
  END IF;

  -- 8. Validação de Produto Ativo com colunas qualificadas
  SELECT p.id, p.sku, p.name, p.image_path, p.active 
  INTO v_product 
  FROM public.products p 
  WHERE p.id = v_variant.product_id;

  IF NOT FOUND OR v_product.active = false THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INACTIVE_PRODUCT',
      'message', 'Produto desativado ou indisponível para entrada de estoque.'
    );
  END IF;

  -- 9. Transação Atômica: Autoriza contexto da sessão para o gatilho
  PERFORM set_config('app.authorized_stock_rpc', 'true', true);

  -- 10. Atualização do Saldo da Variação
  v_new_stock := v_variant.stock_quantity + p_quantity;

  UPDATE public.product_variants pv
  SET stock_quantity = v_new_stock
  WHERE pv.id = v_variant.id;

  -- 11. Gravação da Movimentação Imutável com created_by e idempotency_key
  INSERT INTO public.stock_movements (
    variant_id, movement_type, quantity, stock_before, stock_after, note, created_by, idempotency_key, created_at
  ) VALUES (
    v_variant.id, 'entry', p_quantity, v_variant.stock_quantity, v_new_stock, 
    COALESCE(p_note, 'Bipagem de entrada física'), v_user_id, p_idempotency_key, NOW()
  ) RETURNING id INTO v_movement_id;

  -- 12. Construção da Resposta Estruturada
  v_response := jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'message', 'Entrada física registrada com sucesso!',
    'variant_id', v_variant.id,
    'product_id', v_product.id,
    'product_name', v_product.name,
    'product_sku', v_product.sku,
    'color', v_variant.color,
    'size', v_variant.size,
    'barcode', v_variant.barcode,
    'stock_before', v_variant.stock_quantity,
    'stock_after', v_new_stock,
    'movement_id', v_movement_id,
    'operator_id', v_user_id,
    'operator_name', v_user_name
  );

  -- 13. Persistência do Registro de Idempotência
  INSERT INTO public.idempotency_records (
    key, user_id, action, resource_id, params, response, created_at
  ) VALUES (
    p_idempotency_key, v_user_id, 'barcode_scan', v_variant.id::text,
    jsonb_build_object('barcode', TRIM(p_barcode), 'quantity', p_quantity),
    v_response, NOW()
  );

  RETURN v_response;
END;
$$;

-- -----------------------------------------------------------------------------
-- SEÇÃO 5: ROTINA ATÔMICA DE AJUSTE ADMINISTRATIVO DE ESTOQUE
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.adjust_inventory_balance(
  p_variant_id UUID,
  p_new_quantity INT,
  p_reason TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_user_name TEXT;
  v_variant RECORD;
  v_diff INT;
  v_mov_id UUID;
  v_idemp_record RECORD;
  v_response JSONB;
BEGIN
  -- 1. Validação de Idempotência Obrigatória
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MISSING_IDEMPOTENCY_KEY',
      'message', 'A chave de idempotência (UUID) é obrigatória para operações que alteram o estoque.'
    );
  END IF;

  -- 2. Validação de Autenticação e Papel de Administrador
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'message', 'Ajuste manual de inventário permitido apenas para administradores.'
    );
  END IF;

  -- 3. Lock Consultivo de Transação
  PERFORM pg_advisory_xact_lock(hashtext('idemp_' || p_idempotency_key::text));

  -- 4. Verificação de Idempotência Persistente
  SELECT ir.user_id, ir.action, ir.params, ir.response 
  INTO v_idemp_record 
  FROM public.idempotency_records ir 
  WHERE ir.key = p_idempotency_key;

  IF FOUND THEN
    IF v_idemp_record.user_id != v_user_id OR 
       v_idemp_record.action != 'inventory_adjustment' OR 
       (v_idemp_record.params->>'variant_id') != p_variant_id::text OR
       (v_idemp_record.params->>'new_quantity')::int != p_new_quantity THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'message', 'Conflito de Idempotência: Esta chave já foi utilizada para outra operação ou parâmetro.'
      );
    END IF;

    RETURN v_idemp_record.response || jsonb_build_object('idempotent_replay', true);
  END IF;

  SELECT up.name INTO v_user_name FROM public.user_profiles up WHERE up.id = v_user_id;

  -- 5. Validação de Justificativa Obrigatória
  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MISSING_REASON',
      'message', 'A justificativa do ajuste administrativo é obrigatória.'
    );
  END IF;

  -- 6. Validação de Saldo Não-Negativo
  IF p_new_quantity IS NULL OR p_new_quantity < 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_QUANTITY',
      'message', 'O novo saldo físico não pode ser um número negativo.'
    );
  END IF;

  -- 7. Lock Exclusivo da Variação
  SELECT pv.id, pv.stock_quantity 
  INTO v_variant 
  FROM public.product_variants pv 
  WHERE pv.id = p_variant_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'message', 'Variação de produto não encontrada.'
    );
  END IF;

  -- 8. Tratamento Explícito de Saldo Idêntico (Zero Delta)
  IF p_new_quantity = v_variant.stock_quantity THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NO_CHANGE',
      'message', 'O saldo informado (' || p_new_quantity || ') é idêntico ao saldo atual. Nenhuma movimentação foi gerada.'
    );
  END IF;

  v_diff := p_new_quantity - v_variant.stock_quantity;

  -- 9. Transação Atômica: Atualização do Saldo
  PERFORM set_config('app.authorized_stock_rpc', 'true', true);

  UPDATE public.product_variants pv 
  SET stock_quantity = p_new_quantity 
  WHERE pv.id = p_variant_id;

  -- 10. Transação Atômica: Gravação de Auditoria com created_by e idempotency_key
  INSERT INTO public.stock_movements (
    variant_id, movement_type, quantity, stock_before, stock_after, note, created_by, idempotency_key, created_at
  ) VALUES (
    p_variant_id, 'adjustment', ABS(v_diff), v_variant.stock_quantity, p_new_quantity, 
    p_reason, v_user_id, p_idempotency_key, NOW()
  ) RETURNING id INTO v_mov_id;

  v_response := jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'message', 'Ajuste de inventário auditado com sucesso!',
    'stock_before', v_variant.stock_quantity,
    'stock_after', p_new_quantity,
    'movement_id', v_mov_id,
    'operator_name', v_user_name
  );

  -- 11. Persistência do Registro de Idempotência
  INSERT INTO public.idempotency_records (
    key, user_id, action, resource_id, params, response, created_at
  ) VALUES (
    p_idempotency_key, v_user_id, 'inventory_adjustment', p_variant_id::text,
    jsonb_build_object('variant_id', p_variant_id::text, 'new_quantity', p_new_quantity),
    v_response, NOW()
  );

  RETURN v_response;
END;
$$;

-- -----------------------------------------------------------------------------
-- SEÇÃO 6: REVOGAÇÃO DE ACESSO PÚBLICO E CONCESSÃO RESTRITA
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.register_barcode_scan(TEXT, INT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_barcode_scan(TEXT, INT, TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_inventory_balance(UUID, INT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_balance(UUID, INT, TEXT, UUID) TO authenticated;

