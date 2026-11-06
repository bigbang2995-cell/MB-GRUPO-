'use client';

/**
 * ESTOQUE DIGITAL — MB GRUPO
 * Provedor de Autenticação, Perfis e Gestão de Funcionários
 * ETAPA 8 — PASSO 3
 *
 * Características de Segurança e Governança:
 * 1. Nomes fictícios eliminados; ambiente de teste opera apenas com 'Administrador' e 'Operador'.
 * 2. Gestão local de colaboradores exclusiva para Administrador (CRUD seguro com SHA-256).
 * 3. Validação de status ativo/inativo impedindo acesso de contas desativadas.
 * 4. Rastreabilidade nominal garantida para colaboradores reais cadastrados.
 * 5. Proteção de autorização nas mutações administrativas (apenas admin).
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  AuthenticatedUser,
  AuthSession,
  AuthContextType,
  EmployeeAccount,
  CreateEmployeeInput,
  UpdateEmployeeInput,
  UpdateAdminAccountInput,
} from '@/types/auth';
import { hashPasswordSha256 } from '@/lib/auth-crypto';
import { findDemoUserByEmail, findDemoUserById, sanitizeUser, ARE_DEMO_USERS_ENABLED } from '@/lib/demo-users';
import {
  safeGetStorage,
  safeSetStorage,
  STORAGE_KEY_EMPLOYEES,
  STORAGE_KEY_ADMIN_CREDENTIALS,
  AdminCredentialsRecord,
} from '@/lib/storage-service';

const SESSION_STORAGE_KEY = 'mb_grupo_auth_session_v2';
const SESSION_DURATION_HOURS = 8; // Turno operacional padrão

/**
 * Validação rigorosa na restauração de sessão local (VULN-01 - ETAPA 8, PASSO 6)
 *
 * REQUISITOS OBRIGATÓRIOS:
 * 1. Validação de expiração da sessão (now < expires).
 * 2. Existência do usuário no cadastro local (stored employees ou DEMO_USERS).
 * 3. Status ativo da conta (isActive === true). Se inativo, descarta a sessão.
 * 4. Correspondência entre ID e perfil oficial (sobrescreve a role com a oficial do cadastro).
 *    NUNCA confiar no perfil ou role armazenados livremente no sessionStorage.
 *
 * NOTA DE SEGURANÇA MANDATÓRIA (REQ-1):
 * Esta validação local no cliente é estritamente demonstrativa para o ambiente local/simulação,
 * prevenindo restauração acidental ou simples adulteração via DevTools na UI. Ela não representa
 * uma garantia criptográfica contra manipulação pelo próprio usuário em seu navegador.
 * A segurança real e definitiva é garantida no servidor/GoTrue via cookies HttpOnly com tokens
 * assinados (JWT) e políticas RLS no PostgreSQL.
 */
function restoreAndValidateSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  try {
    let raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    }
    if (!raw) return null;

    const parsed: AuthSession = JSON.parse(raw);
    const now = Date.now();
    const expires = new Date(parsed.expiresAt).getTime();

    // 1. Validação de expiração da sessão
    if (!parsed.expiresAt || isNaN(expires) || now >= expires) {
      console.warn('[AuthContext] Sessão expirada no armazenamento. Limpando credenciais.');
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem('mb_grupo_auth_session_v1');
      return null;
    }

    const userId = parsed.user?.id;
    if (!userId || typeof userId !== 'string') {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    // 2. Consulta da fonte oficial de cadastro local (credentials customizadas de admin, employees persistidos ou contas de teste)
    const adminStored = safeGetStorage<AdminCredentialsRecord>(STORAGE_KEY_ADMIN_CREDENTIALS);
    const customAdmin = adminStored.success && adminStored.data ? adminStored.data : null;

    const stored = safeGetStorage<EmployeeAccount[]>(STORAGE_KEY_EMPLOYEES);
    const storedEmployees = stored.success && Array.isArray(stored.data) ? stored.data : [];

    let officialAccount: {
      id: string;
      name: string;
      email: string;
      role: 'admin' | 'operator';
      title: string;
      isDemoUser?: boolean;
      isActive?: boolean;
    } | undefined = undefined;

    if (customAdmin && (userId === customAdmin.id || (parsed.user?.role === 'admin' && userId === 'usr-admin-demo'))) {
      officialAccount = {
        id: customAdmin.id || 'usr-admin-demo',
        name: customAdmin.name,
        email: customAdmin.email,
        role: 'admin',
        title: 'Administrador de Estoque',
        isDemoUser: true,
        isActive: true,
      };
    } else {
      const registeredAccount = storedEmployees.find((e) => e.id === userId);
      const demoAccount = findDemoUserById(userId) || findDemoUserByEmail(parsed.user?.email || '');
      officialAccount = registeredAccount || demoAccount;
    }

    // 3. Validação de existência no cadastro local
    if (!officialAccount) {
      console.warn(
        `[AuthContext] Alerta de Segurança (VULN-01): ID "${userId}" não encontrado no cadastro oficial. ` +
        `Sessão descartada por suspeita de falsificação de perfil.`
      );
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem('mb_grupo_auth_session_v1');
      return null;
    }

    // 4. Validação de status ativo da conta
    if (officialAccount.isActive === false) {
      console.warn(
        `[AuthContext] Alerta de Segurança (VULN-01): Conta de colaborador "${officialAccount.email}" está desativada. ` +
        `Restauração de sessão bloqueada.`
      );
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem('mb_grupo_auth_session_v1');
      return null;
    }

    // 5. Garantia de perfil oficial: NUNCA confiar no role armazenado no storage
    // Se o cliente adulterou role: 'admin' no storage, sobrescreve com a role OFICIAL do cadastro
    const sanitizedOfficialUser = sanitizeUser({
      id: officialAccount.id,
      name: officialAccount.name,
      email: officialAccount.email,
      role: officialAccount.role, // Perfil OFICIAL garantido
      title: officialAccount.title,
      isDemoUser: 'isDemoUser' in officialAccount ? officialAccount.isDemoUser : false,
      isActive: officialAccount.isActive,
    });

    const validatedSession: AuthSession = {
      ...parsed,
      user: sanitizedOfficialUser,
    };

    // Sincroniza tanto sessionStorage quanto localStorage com o perfil oficial sanitizado (persiste após F5 e reabertura)
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(validatedSession));
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(validatedSession));

    return validatedSession;
  } catch (err) {
    console.warn('[AuthContext] Falha ao restaurar e validar sessão local:', err);
    try {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignora erro de limpeza
    }
    return null;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Inicialização determinística entre SSR e primeiro ciclo do cliente
  // Previne "Hydration failed because the server rendered HTML didn't match the client"
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Lista de funcionários cadastrados pelo Administrador
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);

  // Restauração de sessão e cadastro local executada estritamente após a hidratação no cliente
  useEffect(() => {
    try {
      const validatedSession = restoreAndValidateSession();
      if (validatedSession) {
        setSession(validatedSession);
        setUser(validatedSession.user);
      } else {
        setSession(null);
        setUser(null);
      }

      const stored = safeGetStorage<EmployeeAccount[]>(STORAGE_KEY_EMPLOYEES);
      if (stored.success && Array.isArray(stored.data)) {
        setEmployees(stored.data);
      }
    } catch (err) {
      console.warn('[AuthContext] Falha ao restaurar dados pós-hidratação:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Limpa a sessão do estado e do armazenamento local
   */
  const clearSessionStorage = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        window.localStorage.removeItem('mb_grupo_auth_session_v1');
      }
    } catch (err) {
      console.warn('[AuthContext] Falha ao limpar armazenamento de sessão:', err);
    }
  }, []);

  /**
   * Salva a sessão ativa de forma segura (sem credenciais)
   */
  const saveSessionStorage = useCallback((newSession: AuthSession) => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
      }
    } catch (err) {
      console.warn('[AuthContext] Falha ao persistir sessão:', err);
    }
  }, []);

  /**
   * Login corporativo: busca primeiro nos funcionários cadastrados, depois nos perfis demo locais
   */
  const signIn = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      setError(null);

      const cleanEmail = (email || '').trim().toLowerCase();
      const cleanPassword = (password || '').trim();

      if (!cleanEmail || !cleanPassword) {
        const msg = 'Informe o e-mail e a senha corporativos.';
        setError(msg);
        return { success: false, error: msg };
      }

      try {
        // 1. Gera hash SHA-256 da senha digitada
        const passwordHash = await hashPasswordSha256(cleanPassword);

        // 2. Consulta credenciais customizadas do Administrador (se alteradas)
        const adminStored = safeGetStorage<AdminCredentialsRecord>(STORAGE_KEY_ADMIN_CREDENTIALS);
        const customAdmin = adminStored.success && adminStored.data ? adminStored.data : null;

        if (customAdmin) {
          // Se o login digitado coincide com o e-mail customizado do Administrador
          if (cleanEmail === customAdmin.email.toLowerCase()) {
            if (customAdmin.passwordHashSha256 !== passwordHash) {
              const msg = 'E-mail ou senha inválidos. Verifique as credenciais.';
              setError(msg);
              return { success: false, error: msg };
            }

            const authenticatedUser = sanitizeUser({
              id: customAdmin.id || 'usr-admin-demo',
              name: customAdmin.name,
              email: customAdmin.email,
              role: 'admin',
              title: 'Administrador de Estoque',
              isDemoUser: true,
              isActive: true,
            });

            const now = new Date();
            const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
            const newSession: AuthSession = {
              user: authenticatedUser,
              token: `admin-token-${authenticatedUser.id}-${Date.now()}`,
              createdAt: now.toISOString(),
              expiresAt,
            };

            setUser(authenticatedUser);
            setSession(newSession);
            saveSessionStorage(newSession);
            return { success: true };
          }

          // Se tentou o e-mail antigo de demonstração mas o login foi personalizado
          if (cleanEmail === 'admin@mbgrupo.com.br' && customAdmin.email.toLowerCase() !== 'admin@mbgrupo.com.br') {
            const msg = 'E-mail ou senha inválidos. Verifique as credenciais.';
            setError(msg);
            return { success: false, error: msg };
          }
        }

        // 3. Busca na lista de funcionários cadastrados
        const registeredEmployee = employees.find(
          (emp) => emp.email.trim().toLowerCase() === cleanEmail
        );

        if (registeredEmployee) {
          if (!registeredEmployee.isActive) {
            const msg = 'Esta conta de colaborador foi desativada pelo Administrador.';
            setError(msg);
            return { success: false, error: msg };
          }

          if (registeredEmployee.passwordHashSha256 !== passwordHash) {
            const msg = 'E-mail ou senha inválidos. Verifique as credenciais.';
            setError(msg);
            return { success: false, error: msg };
          }

          const authenticatedUser = sanitizeUser({
            id: registeredEmployee.id,
            name: registeredEmployee.name,
            email: registeredEmployee.email,
            role: registeredEmployee.role,
            title: registeredEmployee.title,
            isDemoUser: false,
            isActive: registeredEmployee.isActive,
          });

          const now = new Date();
          const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
          const newSession: AuthSession = {
            user: authenticatedUser,
            token: `token-${authenticatedUser.id}-${Date.now()}`,
            createdAt: now.toISOString(),
            expiresAt,
          };

          setUser(authenticatedUser);
          setSession(newSession);
          saveSessionStorage(newSession);
          return { success: true };
        }

        // 3. Fallback para as contas genéricas de teste (Administrador / Operador) em ambiente de dev
        const demoUser = findDemoUserByEmail(cleanEmail);

        if (!demoUser || demoUser.passwordHashSha256 !== passwordHash) {
          const msg = 'E-mail ou senha inválidos. Verifique as credenciais.';
          setError(msg);
          return { success: false, error: msg };
        }

        if (demoUser.isActive === false) {
          const msg = 'Esta conta de demonstração está desativada.';
          setError(msg);
          return { success: false, error: msg };
        }

        const authenticatedUser = sanitizeUser(demoUser);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
        const newSession: AuthSession = {
          user: authenticatedUser,
          token: `demo-token-${authenticatedUser.id}-${Date.now()}`,
          createdAt: now.toISOString(),
          expiresAt,
        };

        setUser(authenticatedUser);
        setSession(newSession);
        saveSessionStorage(newSession);

        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha na validação de credenciais.';
        setError(msg);
        return { success: false, error: msg };
      }
    },
    [employees, saveSessionStorage]
  );

  /**
   * Encerramento formal de sessão (Logout)
   */
  const signOut = useCallback(async () => {
    clearSessionStorage();
    setUser(null);
    setSession(null);
    setError(null);
  }, [clearSessionStorage]);

  /**
   * Troca de operador (encerra a sessão atual e exige nova autenticação)
   */
  const switchOperator = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Helper de autorização: verifica se o usuário autenticado é Administrador
   */
  const requireAdminAuthorization = useCallback((): { authorized: boolean; error?: string } => {
    if (!user || user.role !== 'admin') {
      return {
        authorized: false,
        error: 'Acesso negado: apenas Administradores autenticados podem gerenciar contas de funcionários.',
      };
    }
    return { authorized: true };
  }, [user]);

  /**
   * Criação de nova conta de funcionário (Exclusiva do Administrador)
   */
  const createEmployee = useCallback(
    async (input: CreateEmployeeInput): Promise<{ success: boolean; error?: string; employee?: EmployeeAccount }> => {
      const auth = requireAdminAuthorization();
      if (!auth.authorized) {
        return { success: false, error: auth.error };
      }

      const name = (input.name || '').trim();
      const email = (input.email || '').trim().toLowerCase();
      const title = (input.title || '').trim() || (input.role === 'admin' ? 'Administrador' : 'Operador de Estoque');
      const initialPassword = (input.initialPassword || '').trim();

      if (!name || name.length < 2) {
        return { success: false, error: 'O nome do funcionário deve conter ao menos 2 caracteres.' };
      }
      if (!email || !email.includes('@')) {
        return { success: false, error: 'Informe um e-mail corporativo válido.' };
      }
      if (!initialPassword || initialPassword.length < 6) {
        return { success: false, error: 'A senha inicial deve conter ao menos 6 caracteres.' };
      }

      // Validação de unicidade de login
      const existsInEmployees = employees.some((e) => e.email.toLowerCase() === email);
      const existsInDemo = Boolean(findDemoUserByEmail(email));
      if (existsInEmployees || existsInDemo) {
        return { success: false, error: 'Já existe uma conta cadastrada com este e-mail.' };
      }

      const passwordHash = await hashPasswordSha256(initialPassword);
      const now = new Date().toISOString();
      const newEmployee: EmployeeAccount = {
        id: `usr-func-${Date.now()}`,
        name,
        email,
        role: input.role || 'operator',
        title,
        passwordHashSha256: passwordHash,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      const updated = [newEmployee, ...employees];
      setEmployees(updated);
      safeSetStorage(STORAGE_KEY_EMPLOYEES, updated);

      return { success: true, employee: newEmployee };
    },
    [employees, requireAdminAuthorization]
  );

  /**
   * Atualização cadastral de funcionário (Exclusiva do Administrador)
   */
  const updateEmployee = useCallback(
    async (id: string, input: UpdateEmployeeInput): Promise<{ success: boolean; error?: string }> => {
      const auth = requireAdminAuthorization();
      if (!auth.authorized) {
        return { success: false, error: auth.error };
      }

      const index = employees.findIndex((e) => e.id === id);
      if (index === -1) {
        return { success: false, error: 'Funcionário não encontrado.' };
      }

      const name = (input.name || '').trim();
      const email = (input.email || '').trim().toLowerCase();
      const title = (input.title || '').trim();

      if (!name || name.length < 2) {
        return { success: false, error: 'O nome deve conter ao menos 2 caracteres.' };
      }
      if (!email || !email.includes('@')) {
        return { success: false, error: 'Informe um e-mail válido.' };
      }

      // Verifica colisão de e-mail se foi alterado
      const emailCollision = employees.some(
        (e) => e.id !== id && e.email.toLowerCase() === email
      );
      if (emailCollision) {
        return { success: false, error: 'Este e-mail já pertence a outro colaborador.' };
      }

      const updated = [...employees];
      updated[index] = {
        ...updated[index],
        name,
        email,
        role: input.role,
        title: title || (input.role === 'admin' ? 'Administrador' : 'Operador de Estoque'),
        updatedAt: new Date().toISOString(),
      };

      setEmployees(updated);
      safeSetStorage(STORAGE_KEY_EMPLOYEES, updated);

      // Se o usuário logado for este colaborador, atualiza a sessão ativa
      if (user?.id === id) {
        const updatedUser: AuthenticatedUser = sanitizeUser(updated[index]);
        setUser(updatedUser);
        if (session) {
          const newSess = { ...session, user: updatedUser };
          setSession(newSess);
          saveSessionStorage(newSess);
        }
      }

      return { success: true };
    },
    [employees, requireAdminAuthorization, saveSessionStorage, session, user]
  );

  /**
   * Redefinição de senha de funcionário (Exclusiva do Administrador)
   */
  const resetEmployeePassword = useCallback(
    async (id: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
      const auth = requireAdminAuthorization();
      if (!auth.authorized) {
        return { success: false, error: auth.error };
      }

      const cleanPassword = (newPassword || '').trim();
      if (!cleanPassword || cleanPassword.length < 6) {
        return { success: false, error: 'A nova senha deve possuir ao menos 6 caracteres.' };
      }

      const index = employees.findIndex((e) => e.id === id);
      if (index === -1) {
        return { success: false, error: 'Funcionário não encontrado.' };
      }

      const newHash = await hashPasswordSha256(cleanPassword);
      const updated = [...employees];
      updated[index] = {
        ...updated[index],
        passwordHashSha256: newHash,
        updatedAt: new Date().toISOString(),
      };

      setEmployees(updated);
      safeSetStorage(STORAGE_KEY_EMPLOYEES, updated);

      return { success: true };
    },
    [employees, requireAdminAuthorization]
  );

  /**
   * Desativação ou Reativação de funcionário (Exclusiva do Administrador)
   */
  const toggleEmployeeStatus = useCallback(
    async (id: string): Promise<{ success: boolean; error?: string; isActive?: boolean }> => {
      const auth = requireAdminAuthorization();
      if (!auth.authorized) {
        return { success: false, error: auth.error };
      }

      if (user?.id === id) {
        return { success: false, error: 'Não é permitido desativar a própria conta ativa.' };
      }

      const index = employees.findIndex((e) => e.id === id);
      if (index === -1) {
        return { success: false, error: 'Funcionário não encontrado.' };
      }

      const newStatus = !employees[index].isActive;
      const updated = [...employees];
      updated[index] = {
        ...updated[index],
        isActive: newStatus,
        updatedAt: new Date().toISOString(),
      };

      setEmployees(updated);
      safeSetStorage(STORAGE_KEY_EMPLOYEES, updated);

      return { success: true, isActive: newStatus };
    },
    [employees, requireAdminAuthorization, user]
  );

  /**
   * Gestão da Conta do Administrador: alteração de login, nome e senha
   * Exige validação da senha atual com hash SHA-256 e invalida a sessão antiga
   */
  const updateAdminAccount = useCallback(
    async (input: UpdateAdminAccountInput): Promise<{ success: boolean; error?: string }> => {
      const auth = requireAdminAuthorization();
      if (!auth.authorized) {
        return { success: false, error: auth.error };
      }

      if (!user) {
        return { success: false, error: 'Nenhum usuário autenticado.' };
      }

      const currentPassword = (input.currentPassword || '').trim();
      if (!currentPassword) {
        return { success: false, error: 'Informe a senha atual para confirmar as alterações.' };
      }

      // 1. Valida senha atual
      const currentPasswordHash = await hashPasswordSha256(currentPassword);

      const adminStored = safeGetStorage<AdminCredentialsRecord>(STORAGE_KEY_ADMIN_CREDENTIALS);
      const customAdmin = adminStored.success && adminStored.data ? adminStored.data : null;

      let expectedHash: string | undefined;
      if (customAdmin && (customAdmin.id === user.id || user.id === 'usr-admin-demo')) {
        expectedHash = customAdmin.passwordHashSha256;
      } else {
        const emp = employees.find((e) => e.id === user.id);
        if (emp) {
          expectedHash = emp.passwordHashSha256;
        } else {
          const demo = findDemoUserById(user.id) || findDemoUserByEmail(user.email);
          expectedHash = demo?.passwordHashSha256;
        }
      }

      if (!expectedHash || expectedHash !== currentPasswordHash) {
        return { success: false, error: 'A senha atual informada está incorreta.' };
      }

      // 2. Valida novo e-mail se fornecido
      const newEmail = input.newEmail ? input.newEmail.trim().toLowerCase() : undefined;
      if (newEmail !== undefined && newEmail !== user.email.toLowerCase()) {
        if (!newEmail || !newEmail.includes('@') || !newEmail.includes('.')) {
          return { success: false, error: 'Informe um e-mail corporativo válido.' };
        }

        // Unicidade de e-mail contra funcionários
        const emailCollisionEmployees = employees.some(
          (e) => e.id !== user.id && e.email.toLowerCase() === newEmail
        );
        const demoOperator = findDemoUserByEmail(newEmail);
        const emailCollisionDemo = demoOperator && demoOperator.id !== user.id;

        if (emailCollisionEmployees || emailCollisionDemo) {
          return { success: false, error: 'Este e-mail corporativo já está em uso por outro usuário.' };
        }
      }

      // 3. Valida nova senha se fornecida
      const newPassword = input.newPassword ? input.newPassword.trim() : undefined;
      if (newPassword !== undefined && newPassword.length > 0) {
        if (newPassword.length < 6) {
          return { success: false, error: 'A nova senha deve possuir ao menos 6 caracteres.' };
        }
      }

      // 4. Valida novo nome se fornecido
      const newName = input.newName ? input.newName.trim() : undefined;
      if (newName !== undefined && newName.length < 2) {
        return { success: false, error: 'O nome deve possuir ao menos 2 caracteres.' };
      }

      // 5. Calcula dados consolidados
      const updatedName = newName || user.name;
      const updatedEmail = newEmail || user.email;
      const updatedHash = newPassword
        ? await hashPasswordSha256(newPassword)
        : expectedHash;

      const adminRecord: AdminCredentialsRecord = {
        id: user.id || 'usr-admin-demo',
        name: updatedName,
        email: updatedEmail,
        passwordHashSha256: updatedHash,
        updatedAt: new Date().toISOString(),
      };

      safeSetStorage(STORAGE_KEY_ADMIN_CREDENTIALS, adminRecord);

      // Se o administrador constar na lista de funcionários, atualiza lá também
      const empIndex = employees.findIndex((e) => e.id === user.id);
      if (empIndex !== -1) {
        const updatedEmployees = [...employees];
        updatedEmployees[empIndex] = {
          ...updatedEmployees[empIndex],
          name: updatedName,
          email: updatedEmail,
          passwordHashSha256: updatedHash,
          updatedAt: new Date().toISOString(),
        };
        setEmployees(updatedEmployees);
        safeSetStorage(STORAGE_KEY_EMPLOYEES, updatedEmployees);
      }

      // 6. Atualiza estado e renova sessão com novo token (invalidação de sessão antiga)
      const updatedUser: AuthenticatedUser = {
        ...user,
        id: adminRecord.id,
        name: updatedName,
        email: updatedEmail,
        role: 'admin',
      };

      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
      const newSession: AuthSession = {
        user: updatedUser,
        token: `admin-token-${updatedUser.id}-${Date.now()}`,
        createdAt: now.toISOString(),
        expiresAt,
      };

      setUser(updatedUser);
      setSession(newSession);
      saveSessionStorage(newSession);

      return { success: true };
    },
    [employees, requireAdminAuthorization, saveSessionStorage, user]
  );

  const isRealAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_SUPABASE_AUTH === 'true';

  const value: AuthContextType = {
    user,
    session,
    isAuthenticated: Boolean(user && session),
    isLoading,
    isDemoMode: ARE_DEMO_USERS_ENABLED,
    authMode: isRealAuthEnabled ? 'supabase_auth' : 'simulation',
    error,
    employees,
    signIn,
    signOut,
    switchOperator,
    clearError,
    createEmployee,
    updateEmployee,
    resetEmployeePassword,
    toggleEmployeeStatus,
    updateAdminAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um <AuthProvider>');
  }
  return context;
}
