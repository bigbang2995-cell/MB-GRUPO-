/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Endpoint Protegido de Servidor: Gestão de Funcionários (Listar e Criar)
 * ETAPA 8 — PASSO 4
 *
 * Características de Segurança:
 * 1. Autenticação e autorização validadas no servidor antes da execução.
 * 2. Somente Administradores com perfil ativo podem criar contas.
 * 3. Utiliza createAdminClient() com Service Role Key estritamente no servidor.
 * 4. Senhas de produção são processadas pelo motor Argon2id/bcrypt do Supabase Auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateCsrfProtection } from '@/lib/security/csrf';

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

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    // Em ambiente local sem Supabase configurado, retorna 401 Não Autenticado (VULN-02 mitigada)
    if (!supabase) {
      return NextResponse.json(
        {
          error: 'Não autenticado: operação administrativa de servidor indisponível em modo de simulação sem credenciais seguras.',
          mode: 'simulation',
        },
        { status: 401 }
      );
    }

    // 1. Validação de Sessão no Servidor
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Não autenticado. Sessão expirada ou inválida.' },
        { status: 401 }
      );
    }

    // 2. Validação de Autorização (Apenas Administrador Ativo)
    const { data: profileData, error: profileError } = await supabase
      .from('user_profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single();

    const profile = profileData as unknown as UserProfileRecord | null;

    if (profileError || !profile || profile.role !== 'admin' || profile.is_active === false) {
      return NextResponse.json(
        { error: 'Acesso negado: Somente administradores ativos possuem autorização.' },
        { status: 403 }
      );
    }

    // 3. Consulta de Funcionários
    const { data: employeesData, error: listError } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (listError) {
      return NextResponse.json(
        { error: 'Falha ao consultar perfis de colaboradores.' },
        { status: 500 }
      );
    }

    const employees = employeesData as unknown as UserProfileRecord[];
    return NextResponse.json({ success: true, employees });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno no servidor.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Defesa Anti-CSRF Estrita (VULN-03 mitigada)
    const csrf = validateCsrfProtection(req);
    if (!csrf.valid) {
      return NextResponse.json({ error: csrf.error }, { status: csrf.status || 403 });
    }

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

    // 2. Valida se o chamador possui sessão válida no servidor (GoTrue JWT)
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Não autenticado. Efetue login para continuar.' },
        { status: 401 }
      );
    }

    // 2. Valida se o chamador é Administrador ativo (Consulta no servidor, nunca confia no cliente)
    const { data: callerData, error: profileError } = await supabase
      .from('user_profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single();

    const callerProfile = callerData as unknown as UserProfileRecord | null;

    if (
      profileError ||
      !callerProfile ||
      callerProfile.role !== 'admin' ||
      callerProfile.is_active === false
    ) {
      return NextResponse.json(
        { error: 'Acesso negado: Somente administradores autenticados podem cadastrar novos funcionários.' },
        { status: 403 }
      );
    }

    // 3. Parse e Validação do Corpo da Requisição
    const body = (await req.json()) as {
      name?: string;
      email?: string;
      role?: string;
      title?: string;
      initialPassword?: string;
    };
    const { name, email, role, title, initialPassword } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json(
        { error: 'O nome completo do colaborador é obrigatório (mínimo 2 caracteres).' },
        { status: 400 }
      );
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Informe um e-mail corporativo válido.' },
        { status: 400 }
      );
    }

    if (!initialPassword || typeof initialPassword !== 'string' || initialPassword.length < 6) {
      return NextResponse.json(
        { error: 'A senha inicial deve possuir no mínimo 6 caracteres.' },
        { status: 400 }
      );
    }

    if (role !== 'admin' && role !== 'operator') {
      return NextResponse.json(
        { error: 'Perfil inválido. Os perfis permitidos são admin ou operator.' },
        { status: 400 }
      );
    }

    // 4. Criação Segura via Supabase Admin API no Servidor
    // A senha é transmitida em canal HTTPS protegido e hasheada nativamente com Argon2id/bcrypt no GoTrue
    const { data: createdAuthUser, error: createError } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: initialPassword.trim(),
      email_confirm: true,
      user_metadata: {
        full_name: name.trim(),
        role,
        title: title?.trim() || (role === 'admin' ? 'Administrador' : 'Operador de Estoque'),
        is_active: true,
      },
    });

    if (createError) {
      return NextResponse.json(
        { error: `Falha ao criar usuário corporativo: ${createError.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Colaborador criado com sucesso no Supabase Auth.',
        user: {
          id: createdAuthUser.user.id,
          name: name.trim(),
          email: createdAuthUser.user.email,
          role,
          title: title?.trim() || (role === 'admin' ? 'Administrador' : 'Operador de Estoque'),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno no servidor.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
