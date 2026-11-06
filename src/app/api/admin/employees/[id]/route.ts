/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Endpoint Protegido de Servidor: Modificação de Colaborador e Redefinição de Senha
 * ETAPA 8 — PASSO 4
 *
 * Características de Segurança:
 * 1. Autenticação e autorização verificadas no servidor antes de qualquer alteração.
 * 2. Bloqueio estrito de acesso para perfil 'operator'.
 * 3. Proíbe auto-desativação do administrador ativo para evitar bloqueios de sistema.
 * 4. Operações executadas via Admin Client protegido com Service Role Key no servidor.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateCsrfProtection } from '@/lib/security/csrf';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UserProfileRecord {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'operator';
  title: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Atualização Cadastral (Nome, E-mail, Papel, Cargo)
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    // 1. Defesa Anti-CSRF Estrita (VULN-03 mitigada)
    const csrf = validateCsrfProtection(req);
    if (!csrf.valid) {
      return NextResponse.json({ error: csrf.error }, { status: csrf.status || 403 });
    }

    const { id } = await params;
    const supabase = await createServerSupabaseClient();
    const adminClient = createAdminClient();

    // Se estiver em ambiente local sem chaves reais configuradas (VULN-02 mitigada)
    if (!supabase || !adminClient) {
      return NextResponse.json(
        {
          error: 'Não autenticado: operação administrativa de servidor indisponível em modo de simulação sem credenciais seguras.',
          mode: 'simulation',
        },
        { status: 401 }
      );
    }

    // 2. Validação de Sessão
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }

    // 3. Validação de Autorização (Admin Ativo)
    const { data: callerData } = await supabase
      .from('user_profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single();

    const callerProfile = callerData as unknown as UserProfileRecord | null;

    if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.is_active === false) {
      return NextResponse.json(
        { error: 'Acesso negado: Somente administradores ativos possuem autorização.' },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      name?: string;
      email?: string;
      role?: string;
      title?: string;
    };
    const { name, email, role, title } = body;

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome deve possuir ao menos 2 caracteres.' }, { status: 400 });
    }
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
    }

    // 4. Atualização via Admin API
    const { error: updateError } = await adminClient.auth.admin.updateUserById(id, {
      email: email.trim().toLowerCase(),
      user_metadata: {
        full_name: name.trim(),
        role,
        title: title?.trim(),
      },
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Dados cadastrais atualizados com sucesso.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno no servidor.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Ações de Redefinição de Senha e Ativação/Desativação de Conta
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    // 1. Defesa Anti-CSRF Estrita (VULN-03 mitigada)
    const csrf = validateCsrfProtection(req);
    if (!csrf.valid) {
      return NextResponse.json({ error: csrf.error }, { status: csrf.status || 403 });
    }

    const { id } = await params;
    const supabase = await createServerSupabaseClient();
    const adminClient = createAdminClient();

    // Se estiver em ambiente local sem chaves reais configuradas (VULN-02 mitigada)
    if (!supabase || !adminClient) {
      return NextResponse.json(
        {
          error: 'Não autenticado: operação administrativa de servidor indisponível em modo de simulação sem credenciais seguras.',
          mode: 'simulation',
        },
        { status: 401 }
      );
    }

    // 1. Validação de Sessão
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }

    // 2. Validação de Autorização (Admin Ativo)
    const { data: callerData } = await supabase
      .from('user_profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single();

    const callerProfile = callerData as unknown as UserProfileRecord | null;

    if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.is_active === false) {
      return NextResponse.json(
        { error: 'Acesso negado: Somente administradores ativos possuem autorização.' },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      action?: string;
      newPassword?: string;
      isActive?: boolean;
    };
    const { action, newPassword, isActive } = body;

    // Ação: Redefinição de Senha
    if (action === 'reset_password') {
      if (!newPassword || newPassword.length < 6) {
        return NextResponse.json(
          { error: 'A nova senha deve possuir ao menos 6 caracteres.' },
          { status: 400 }
        );
      }

      const { error: passError } = await adminClient.auth.admin.updateUserById(id, {
        password: newPassword.trim(),
      });

      if (passError) {
        return NextResponse.json({ error: passError.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, message: 'Senha redefinida com sucesso pelo Administrador.' });
    }

    // Ação: Alteração de Status (Ativar / Desativar)
    if (action === 'toggle_status') {
      if (user.id === id && isActive === false) {
        return NextResponse.json(
          { error: 'Não é permitido desativar a própria conta de administrador ativa.' },
          { status: 400 }
        );
      }

      const { error: statusError } = await adminClient.auth.admin.updateUserById(id, {
        user_metadata: { is_active: Boolean(isActive) },
      });

      if (statusError) {
        return NextResponse.json({ error: statusError.message }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `Conta ${isActive ? 'reativada' : 'desativada'} com sucesso.`,
      });
    }

    return NextResponse.json({ error: 'Ação não reconhecida.' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno no servidor.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
