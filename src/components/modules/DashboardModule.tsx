'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  ProductVariant,
  Product,
  StockMovement,
  MarketplaceSku,
  UserRole,
} from '@/types/database';
import { PendingExit } from './OutputsModule';
import { BANNER_WAREHOUSE_BG } from '@/lib/image-assets';
import { ProductCreateModal } from '@/components/modules/ProductCreateModal';
import { extractBaseSku } from '@/lib/barcode-service';
import {
  Boxes,
  FileText,
  AlertTriangle,
  AlertCircle,
  Plus,
  Pencil,
  CalendarCheck,
  Download,
  Upload,
  FileSpreadsheet,
  History,
  Search,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Clock,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
  Package,
  PackagePlus,
  PackageMinus,
  SlidersHorizontal,
  Info,
  CheckCircle2,
} from 'lucide-react';

// Ciclo determinístico de frases motivacionais (sem repetição antes de completar o ciclo de 14 dias)
const MOTIVATIONAL_QUOTES = [
  'Organização que impulsiona grandes resultados.',
  'Disciplina no estoque hoje, mais vendas amanhã.',
  'Precisão e agilidade em cada movimentação física.',
  'O controle rigoroso do estoque é a base do sucesso operacional.',
  'Cada item conferido com cuidado fortalece a confiança do cliente.',
  'Excelência logística começa nos pequenos detalhes da rotina.',
  'Organização e método transformam processos em alta performance.',
  'Estoque alinhado, expedição rápida e entregas sem atrasos.',
  'Foco na qualidade: transformar a rotina em máxima eficiência diária.',
  'Atenção aos detalhes em cada conferência garante zero divergências.',
  'Agilidade com controle: esse é o padrão de excelência MB Grupo.',
  'Compromisso diário com a exatidão, rastreabilidade e integridade.',
  'A gestão inteligente de estoque impulsiona todo o ecossistema.',
  'Grandes conquistas são construídas com processos diários bem executados.',
];

export interface DashboardModuleProps {
  variants: (ProductVariant & { product: Product })[];
  movements: StockMovement[];
  marketplaceSkus?: (MarketplaceSku & {
    variant: ProductVariant & { product: Product };
  })[];
  pendingExits?: PendingExit[];
  onNavigateToStock?: () => void;
  onNavigateToScanner: () => void;
  onNavigateToOutputs?: () => void;
  onNavigateToMovements?: () => void;
  onNavigateToSkus?: () => void;
  onAddVariant?: (variant: ProductVariant & { product: Product }) => { success: boolean; error?: string } | void;
  onCreateProduct?: (product: Product, newVariants: (ProductVariant & { product: Product })[]) => { success: boolean; error?: string } | void;
  onRestoreBackup?: (data: {
    variants?: any[];
    movements?: any[];
    marketplaceSkus?: any[];
  }) => void;
  currentRole: UserRole;
}

export function DashboardModule({
  variants,
  movements,
  marketplaceSkus = [],
  pendingExits = [],
  onNavigateToStock = () => {},
  onNavigateToScanner,
  onNavigateToOutputs = () => {},
  onNavigateToMovements = () => {},
  onNavigateToSkus = () => {},
  onAddVariant,
  onCreateProduct,
  onRestoreBackup,
  currentRole,
}: DashboardModuleProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NORMAL' | 'LOW' | 'CRITICAL'>('ALL');
  const [sizeFilter, setSizeFilter] = useState('ALL');
  const [timeFilter, setTimeFilter] = useState('30d');
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const [quickActionModal, setQuickActionModal] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── 0. ESTADO DETERMINÍSTICO DO CLIENTE (SEM BLOQUEIO DE PRÉ-RENDERIZAÇÃO) ───
  const [dailyQuote, setDailyQuote] = useState(MOTIVATIONAL_QUOTES[0]);
  const [todayIso, setTodayIso] = useState<string>('');

  useEffect(() => {
    const currentDate = new Date();
    const dayDiff = Math.max(
      0,
      Math.floor(
        (new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime() -
          new Date(2026, 0, 1).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    );
    setDailyQuote(MOTIVATIONAL_QUOTES[dayDiff % MOTIVATIONAL_QUOTES.length]);
    setTodayIso(
      `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`
    );
  }, []);

  // ─── 1. CÁLCULO DOS 4 INDICADORES REAIS (SEM DADOS FICTÍCIOS) ───
  const isToday = (dateStr: string) => {
    if (!dateStr || !todayIso) return false;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}` === todayIso;
    } catch {
      return false;
    }
  };

  // 1. Entradas de hoje
  const todayEntriesCount = movements
    .filter((m) => m.movement_type === 'entry' && isToday(m.created_at))
    .reduce((acc, m) => acc + (m.quantity || 0), 0);

  // 2. Saídas de hoje
  const todayExitsCount = movements
    .filter((m) => m.movement_type === 'exit' && isToday(m.created_at))
    .reduce((acc, m) => acc + (m.quantity || 0), 0);

  // 3. Peças disponíveis (soma exata das variações em memória)
  const totalStockCount = variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);

  // 4. Estoque baixo / zerado
  const zeroStockVariants = variants.filter((v) => (v.stock_quantity || 0) <= 0);
  const lowStockOnlyVariants = variants.filter(
    (v) => (v.stock_quantity || 0) > 0 && (v.stock_quantity || 0) <= ((v as any).min_stock ?? 15)
  );
  const attentionVariants = [...zeroStockVariants, ...lowStockOnlyVariants];
  const criticalCount = zeroStockVariants.length;
  const lowStockCount = lowStockOnlyVariants.length;
  const totalAttentionCount = attentionVariants.length;

  // ─── 2. AGRUPAMENTO POR PRODUTO PRINCIPAL (1 LINHA POR MODELO) ───
  interface ProductGroup {
    id: string;
    sku: string;
    name: string;
    image_path: string | null;
    total_stock: number;
    colors: string[];
    sizes: string[];
    variants: (ProductVariant & { product: Product })[];
  }

  const toggleExpandProduct = (id: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const productGroupsMap = new Map<string, ProductGroup>();

  variants.forEach((v) => {
    const p = v.product;
    const prodId = p?.id || v.product_id;
    if (!productGroupsMap.has(prodId)) {
      productGroupsMap.set(prodId, {
        id: prodId,
        sku: p?.sku || '',
        name: p?.name || 'Produto',
        image_path: p?.image_path || null,
        total_stock: 0,
        colors: [],
        sizes: [],
        variants: [],
      });
    }

    const group = productGroupsMap.get(prodId)!;
    group.total_stock += v.stock_quantity || 0;
    if (v.color && !group.colors.includes(v.color)) {
      group.colors.push(v.color);
    }
    if (v.size && !group.sizes.includes(v.size)) {
      group.sizes.push(v.size);
    }
    group.variants.push(v);
  });

  const allProductGroups = Array.from(productGroupsMap.values());

  const availableSizes = Array.from(
    new Set(variants.map((v) => v.size).filter(Boolean))
  ).sort();

  // Filtragem dos produtos da tabela
  const filteredProductGroups = allProductGroups.filter((g) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      g.name.toLowerCase().includes(term) ||
      g.sku.toLowerCase().includes(term) ||
      g.colors.some((c) => c.toLowerCase().includes(term)) ||
      g.variants.some((v) => (v.barcode && v.barcode.includes(term)));

    if (!matchesSearch) return false;

    if (sizeFilter !== 'ALL' && !g.sizes.includes(sizeFilter)) return false;

    if (statusFilter === 'NORMAL') return g.total_stock > 15;
    if (statusFilter === 'LOW') return g.total_stock > 0 && g.total_stock <= 15;
    if (statusFilter === 'CRITICAL') return g.total_stock <= 0;

    return true;
  });

  // Função auxiliar para badge de status conforme regra de negócio MB Grupo
  const getStatusBadge = (quantity: number) => {
    if (quantity <= 0) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-600 border border-rose-200">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          Crítico
        </span>
      );
    }
    if (quantity <= 15) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Estoque baixo
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Normal
      </span>
    );
  };

  // ─── 3. CÁLCULO DE PEÇAS MAIS VENDIDAS PARA O GRÁFICO DE BARRAS VERTICAL ───
  const salesExits = movements.filter((m) => {
    if (m.movement_type !== 'exit') return false;

    // Filtro por período selecionado
    if (timeFilter === 'today' && !isToday(m.created_at)) {
      return false;
    }
    if (timeFilter === '7d' && todayIso) {
      const mDate = new Date(m.created_at);
      const cutoff = new Date(`${todayIso}T23:59:59`).getTime() - 7 * 86400000;
      if (mDate.getTime() < cutoff) return false;
    }
    if (timeFilter === '30d' && todayIso) {
      const mDate = new Date(m.created_at);
      const cutoff = new Date(`${todayIso}T23:59:59`).getTime() - 30 * 86400000;
      if (mDate.getTime() < cutoff) return false;
    }

    const noteLower = (m.note || '').toLowerCase();
    const justLower = (m.justification || '').toLowerCase();
    const chanLower = (m.channel || '').toLowerCase();

    const isNonSale =
      noteLower.includes('avaria') ||
      justLower.includes('avaria') ||
      chanLower.includes('avaria') ||
      noteLower.includes('defeito') ||
      justLower.includes('defeito') ||
      chanLower.includes('defeito') ||
      noteLower.includes('transfer') ||
      justLower.includes('transfer') ||
      chanLower.includes('transfer') ||
      noteLower.includes('acerto') ||
      justLower.includes('acerto') ||
      chanLower.includes('acerto') ||
      noteLower.includes('ajuste') ||
      justLower.includes('ajuste') ||
      chanLower.includes('ajuste') ||
      noteLower.includes('teste') ||
      justLower.includes('teste') ||
      chanLower.includes('teste');

    return !isNonSale && (m.quantity || 0) > 0;
  });

  const productSalesMap = new Map<
    string,
    {
      productId: string;
      productName: string;
      sku: string;
      imagePath?: string | null;
      totalSold: number;
    }
  >();

  salesExits.forEach((m) => {
    const variant = variants.find((v) => v.id === m.variant_id) || (m.variant as any);
    const product = variant?.product;
    const productId = product?.id || variant?.product_id || m.variant_id;
    const productName = product?.name || 'Produto';
    const sku = product?.sku || '';
    const imagePath = product?.image_path || null;

    if (!productSalesMap.has(productId)) {
      productSalesMap.set(productId, {
        productId,
        productName,
        sku,
        imagePath,
        totalSold: 0,
      });
    }

    const item = productSalesMap.get(productId)!;
    item.totalSold += m.quantity || 0;
  });

  // Apenas produtos que realmente tiveram saídas confirmadas no período (sem preenchimento fictício)
  const topSellingProducts = Array.from(productSalesMap.values())
    .filter((p) => p.totalSold > 0)
    .sort((a, b) => b.totalSold - a.totalSold);

  const displayChartItems = topSellingProducts.slice(0, 5);
  const maxSoldInChart = Math.max(...displayChartItems.map((i) => i.totalSold), 0);
  const chartScaleMax = maxSoldInChart > 0 ? Math.max(80, Math.ceil(maxSoldInChart / 20) * 20) : 80;

  // ─── 4. ATIVIDADE RECENTE (4 ITENS) ───
  const recentMovements = movements.slice(0, 4);

  const formatRelativeTime = (dateStr: string) => {
    if (!dateStr) return 'Recente';
    try {
      const d = new Date(dateStr);
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      if (todayIso && dateStr.startsWith(todayIso)) {
        return `Hoje às ${hours}:${minutes}`;
      }
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} às ${hours}:${minutes}`;
    } catch {
      return 'Recente';
    }
  };

  // Funções de apoio (Backup e Exportação)
  const handleExportCSV = () => {
    const headers = ['SKU', 'Produto', 'Cor', 'Tamanho', 'Codigo_Barras', 'Estoque_Fisico'];
    const rows = variants.map((v) => [
      v.product?.sku || '',
      `"${v.product?.name || ''}"`,
      v.color,
      v.size,
      v.barcode || '',
      v.stock_quantity,
    ]);
    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `MB_Grupo_Estoque_Local_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadBackup = () => {
    const dataStr = JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        system: 'Estoque Digital MB Grupo',
        mode: 'demonstracao_local',
        variants,
        movements,
        marketplaceSkus,
        pendingExits,
      },
      null,
      2
    );
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_local_mb_grupo_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (onRestoreBackup) {
          onRestoreBackup(parsed);
          alert('Backup restaurado com sucesso para a sessão local em memória!');
          setQuickActionModal(null);
        }
      } catch (err) {
        alert('Erro ao processar o arquivo de backup. Formato JSON inválido.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ─── 1. BANNER SUPERIOR OFICIAL ESCURO CONFORME REFERÊNCIA ─── */}
      <div
        className="relative overflow-hidden rounded-2xl bg-cover border border-slate-800 shadow-md p-6 sm:p-7 text-white min-h-[175px] flex flex-col md:flex-row items-start md:items-center justify-between gap-6"
        style={{
          backgroundImage: `url("${BANNER_WAREHOUSE_BG}")`,
          backgroundPosition: '50% 45%',
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Camada de vinheta e tonalização escura para contraste tipográfico perfeito preservando o efeito 3D */}
        <div className="absolute inset-0 bg-gradient-to-b md:bg-gradient-to-r from-[#060b14]/95 via-[#060b14]/80 md:via-[#060b14]/70 md:via-40% to-[#060b14]/70 md:to-[#060b14]/20 pointer-events-none" />

        {/* Conteúdo à esquerda com Logo Oficial e Título */}
        <div className="relative z-10 max-w-xl">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            {/* Logo MB Grupo colorida */}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/90 border border-slate-700/80 overflow-hidden shadow-md shrink-0">
              <img
                src="/images/mb-logo-cart.jpg"
                alt="MB Grupo"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex items-center gap-1.5 pr-3 border-r border-slate-700/80 leading-none">
              <span className="text-sm font-black tracking-wider text-white">MB</span>
              <span className="text-[10px] font-bold tracking-[0.25em] text-slate-400">GRUPO</span>
            </div>
            {/* Selo único de Demonstração */}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/40 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              Modo Demonstração • Dados em Memória Local
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white drop-shadow-md">
            Bem-vindo ao Estoque MB! 👋
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-slate-200 leading-relaxed font-medium drop-shadow-sm">
            Aqui é o seu centro de operação do estoque. Gerencie produtos, acompanhe as saídas e
            mantenha tudo sempre atualizado.
          </p>
        </div>

        {/* Card institucional escuro à direita com frase motivacional diária */}
        <div className="relative z-10 self-stretch md:self-auto flex items-center shrink-0">
          <div className="rounded-xl border border-slate-700/80 bg-[#0d1726]/90 backdrop-blur-md px-5 py-3.5 shadow-xl flex flex-col justify-center min-w-[240px] max-w-[280px]">
            <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black tracking-wider text-white">MB</span>
                <span className="text-[9px] font-bold tracking-[0.25em] text-slate-400">GRUPO</span>
              </div>
              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                Mensagem do Dia
              </span>
            </div>
            <p className="text-xs font-medium text-slate-200 italic leading-snug">
              &ldquo;{dailyQuote}&rdquo;
            </p>
            <span className="text-[10px] text-slate-400 font-semibold mt-2 block">
              MB Grupo
            </span>
          </div>
        </div>
      </div>

      {/* ─── 2. OS 4 INDICADORES CONFORME A ORDEM EXATA DA REFERÊNCIA ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Entradas de hoje (Ícone verde) */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-100/80 text-emerald-600">
            <PackagePlus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-600 leading-tight">
              Entradas de hoje
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                {todayEntriesCount}
              </span>
              <span className="text-xs font-medium text-slate-500">un.</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Produtos recebidos no dia
            </p>
          </div>
        </div>

        {/* 2. Saídas de hoje (Ícone vermelho) */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 border border-rose-100/80 text-rose-600">
            <PackageMinus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-600 leading-tight">
              Saídas de hoje
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                {todayExitsCount}
              </span>
              <span className="text-xs font-medium text-slate-500">un.</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Produtos registrados no dia
            </p>
          </div>
        </div>

        {/* 3. Peças disponíveis (Ícone azul) */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 border border-blue-100/80 text-blue-600">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-600 leading-tight">
              Peças disponíveis
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                {totalStockCount.toLocaleString('pt-BR')}
              </span>
              <span className="text-xs font-medium text-slate-500">un.</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Soma de todas as unidades em estoque
            </p>
          </div>
        </div>

        {/* 4. Estoque baixo / zerado (Ícone vermelho de alerta) */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 border border-rose-100/80 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-600 leading-tight">
              Estoque baixo / zerado
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                {totalAttentionCount}
              </span>
              <span className="text-xs font-medium text-slate-500">variações</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Precisam de reposição {criticalCount > 0 ? `(${criticalCount} zeradas)` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* ─── 3. ESTRUTURA PRINCIPAL EM DUAS COLUNAS CONFORME DESIGN DA IMAGEM ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* COLUNA ESQUERDA (~66%): PRODUTOS EM ESTOQUE + ALERTAS */}
        <div className="lg:col-span-8 space-y-6">
          {/* CARD: PRODUTOS EM ESTOQUE */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Boxes className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 leading-none">
                    Produtos em estoque
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-none">
                    Visão geral dos principais produtos (119 variações cadastradas)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {currentRole === 'admin' && (
                  <button
                    onClick={() => setQuickActionModal('novo_sku')}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-2xs transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Novo SKU
                  </button>
                )}
                <button
                  onClick={onNavigateToStock}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                >
                  Ver todos
                </button>
              </div>
            </div>

            {/* Barra de Filtros e Busca */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por produto, SKU, cor ou tamanho..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800 placeholder:text-slate-400"
                />
              </div>

              {/* Filtro de Tamanhos */}
              <select
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value)}
                className="py-1.5 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">Todos os tamanhos</option>
                {availableSizes.map((sz) => (
                  <option key={sz} value={sz}>
                    {sz}
                  </option>
                ))}
              </select>

              {/* Filtro de Status */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="py-1.5 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">Todos os status</option>
                <option value="CRITICAL">Sem estoque (0 un.)</option>
                <option value="LOW">Estoque baixo (1-15 un.)</option>
                <option value="NORMAL">Normal (&gt; 15 un.)</option>
              </select>

              <button
                type="button"
                className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
                Filtros
              </button>
            </div>

            {/* Tabela de Produtos (1 linha principal por modelo V30, expansível) */}
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-2.5 px-3">Imagem</th>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">Produto</th>
                    <th className="py-2.5 px-3">Cor</th>
                    <th className="py-2.5 px-3">Tamanho</th>
                    <th className="py-2.5 px-3">Quantidade</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProductGroups.slice(0, 5).map((group) => {
                    const isExpanded = expandedProductIds.has(group.id);
                    const primaryColor =
                      group.colors.length > 1
                        ? `${group.colors[0]} (+${group.colors.length - 1})`
                        : group.colors[0] || 'Padrão';
                    const primarySize = group.sizes.join(', ') || 'TU';

                    return (
                      <React.Fragment key={group.id}>
                        <tr
                          onClick={() => toggleExpandProduct(group.id)}
                          className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                        >
                          {/* Imagem */}
                          <td className="py-2.5 px-3">
                            <div className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                              {group.image_path ? (
                                <img
                                  src={group.image_path}
                                  alt={group.name}
                                  className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                                />
                              ) : (
                                <Package className="h-5 w-5 text-slate-400" />
                              )}
                            </div>
                          </td>

                          {/* SKU */}
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                            {group.sku}
                          </td>

                          {/* Produto */}
                          <td className="py-2.5 px-3 font-bold text-slate-900 max-w-[160px] truncate">
                            {group.name}
                          </td>

                          {/* Cor */}
                          <td className="py-2.5 px-3 text-slate-600">
                            {primaryColor}
                          </td>

                          {/* Tamanho */}
                          <td className="py-2.5 px-3 text-slate-600 font-medium">
                            {primarySize}
                          </td>

                          {/* Quantidade Total */}
                          <td className="py-2.5 px-3 font-bold text-slate-900">
                            {group.total_stock}
                          </td>

                          {/* Status Badge */}
                          <td className="py-2.5 px-3">
                            {getStatusBadge(group.total_stock)}
                          </td>

                          {/* Ações / Expandir */}
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandProduct(group.id);
                              }}
                              className="p-1 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                              title="Ver variações do modelo"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>

                        {/* Linha de Expansão Accordion: Detalhes das Variações Reais */}
                        {isExpanded && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={8} className="p-3 border-t border-b border-slate-200/70">
                              <div className="rounded-xl bg-white border border-slate-200/80 p-3 shadow-2xs">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[11px] font-bold text-slate-700">
                                    Grade de Variações ({group.variants.length} variações registradas):
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onNavigateToStock();
                                    }}
                                    className="text-[10px] font-semibold text-blue-600 hover:underline"
                                  >
                                    Abrir no módulo Estoque →
                                  </button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                  {group.variants.map((v) => (
                                    <div
                                      key={v.id}
                                      className="p-2 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between text-[11px]"
                                    >
                                      <div>
                                        <div className="font-bold text-slate-800">
                                          {v.color} • {v.size}
                                        </div>
                                        <span className="font-mono text-[10px] text-slate-400">
                                          {v.barcode || 'Sem código'}
                                        </span>
                                      </div>
                                      <div className="text-right">
                                        <span className="font-black text-slate-900 block">
                                          {v.stock_quantity} un.
                                        </span>
                                        {getStatusBadge(v.stock_quantity)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* CARD: ALERTAS DE ESTOQUE BAIXO (MINI-CARDS HORIZONTAIS DA REFERÊNCIA) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <h4 className="text-sm font-bold text-slate-900 leading-none">
                  Alertas de estoque baixo
                </h4>
                <span className="text-[11px] text-slate-400 font-normal">
                  Produtos que precisam de reposição ({attentionVariants.length} itens)
                </span>
              </div>
              <button
                onClick={onNavigateToStock}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                Ver todos
              </button>
            </div>

            {/* Mini-Cards Horizontais de Alerta */}
            {allProductGroups.filter((p) => p.total_stock <= 15).length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                Nenhum produto em nível crítico ou baixo no momento.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {allProductGroups
                  .filter((p) => p.total_stock <= 15)
                  .slice(0, 4)
                  .map((p) => (
                    <div
                      key={p.id}
                      onClick={onNavigateToStock}
                      className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-2xs transition-all cursor-pointer"
                    >
                      <div className="h-12 w-12 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                        {p.image_path ? (
                          <img
                            src={p.image_path}
                            alt={p.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Package className="h-5 w-5 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {p.name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          SKU {p.sku}
                        </div>
                        <div className="text-xs font-black text-rose-600 mt-0.5">
                          {p.total_stock} un.
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            p.total_stock <= 0
                              ? 'bg-rose-50 text-rose-600 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          } mt-1`}
                        >
                          <span
                            className={`h-1 w-1 rounded-full ${
                              p.total_stock <= 0 ? 'bg-rose-500' : 'bg-amber-500'
                            }`}
                          />
                          {p.total_stock <= 0 ? 'Crítico' : 'Estoque baixo'}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* COLUNA DIREITA (~34%): AS QUE MAIS SAÍRAM + ATIVIDADE RECENTE */}
        <div className="lg:col-span-4 space-y-6">
          {/* CARD SUPERIOR: AS QUE MAIS SAÍRAM (GRÁFICO DE BARRAS VERTICAL DA REFERÊNCIA) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 leading-none">
                  As que mais saíram
                </h4>
              </div>
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="text-xs text-slate-600 border border-slate-200 rounded-lg px-2 py-1 bg-white font-medium focus:outline-none"
              >
                <option value="30d">Últimos 30 dias</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="today">Hoje</option>
              </select>
            </div>

            {/* Gráfico de Barras Vertical ou Estado Vazio quando sem saídas confirmadas */}
            {displayChartItems.length === 0 ? (
              <div className="py-12 px-4 flex flex-col items-center justify-center text-center">
                <div className="h-12 w-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 mb-3 shadow-2xs">
                  <PackageMinus className="h-6 w-6 stroke-[1.5] text-slate-400" />
                </div>
                <p className="text-xs font-bold text-slate-700">
                  Nenhuma saída registrada
                </p>
                <p className="text-[11px] text-slate-400 max-w-[260px] mt-1 leading-relaxed">
                  As peças mais vendidas aparecerão aqui conforme as saídas forem confirmadas no período selecionado.
                </p>
              </div>
            ) : (
            <div className="relative pt-6 pb-2">
              {/* Linhas de Grade e Eixo Y (80, 60, 40, 20, 0) */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none text-[10px] font-mono text-slate-400 select-none pb-14">
                <div className="flex items-center gap-2 border-b border-slate-100/90 pb-0.5">
                  <span className="w-5 text-right font-semibold">80</span>
                  <div className="flex-1 border-b border-dashed border-slate-200/70" />
                </div>
                <div className="flex items-center gap-2 border-b border-slate-100/90 pb-0.5">
                  <span className="w-5 text-right font-semibold">60</span>
                  <div className="flex-1 border-b border-dashed border-slate-200/70" />
                </div>
                <div className="flex items-center gap-2 border-b border-slate-100/90 pb-0.5">
                  <span className="w-5 text-right font-semibold">40</span>
                  <div className="flex-1 border-b border-dashed border-slate-200/70" />
                </div>
                <div className="flex items-center gap-2 border-b border-slate-100/90 pb-0.5">
                  <span className="w-5 text-right font-semibold">20</span>
                  <div className="flex-1 border-b border-dashed border-slate-200/70" />
                </div>
                <div className="flex items-center gap-2 border-b border-slate-200/90 pb-0.5">
                  <span className="w-5 text-right font-semibold">0</span>
                  <div className="flex-1 border-b border-slate-200" />
                </div>
              </div>

              {/* Colunas do Gráfico */}
              <div className="relative z-10 pl-7 pr-2 flex items-end justify-between gap-2 h-44">
                {displayChartItems.map((item, idx) => {
                  const heightPct =
                    chartScaleMax > 0
                      ? Math.min(100, Math.max(8, (item.totalSold / chartScaleMax) * 100))
                      : 8;

                  return (
                    <div
                      key={item.productId || idx}
                      className="flex-1 flex flex-col items-center h-full justify-end group cursor-default"
                    >
                      {/* Valor em cima da barra */}
                      <span className="text-[11px] font-black text-slate-800 mb-1 group-hover:text-blue-600 transition-colors">
                        {item.totalSold}
                      </span>

                      {/* Barra azul vibrante */}
                      <div
                        className="w-full max-w-[42px] bg-slate-100/60 rounded-t-lg overflow-hidden flex items-end justify-center"
                        style={{ height: '70%' }}
                      >
                        <div
                          className="w-full bg-[#2563eb] hover:bg-blue-700 transition-all duration-500 rounded-t-lg shadow-xs"
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>

                      {/* Miniatura do produto e nome abaixo da barra */}
                      <div className="mt-2 flex flex-col items-center w-full">
                        <div className="h-7 w-7 rounded-md bg-white border border-slate-200 overflow-hidden shadow-2xs shrink-0 flex items-center justify-center">
                          {item.imagePath ? (
                            <img
                              src={item.imagePath}
                              alt={item.productName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Package className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </div>
                        <span className="text-[10px] text-slate-700 font-semibold text-center leading-tight line-clamp-2 max-w-[62px] mt-1">
                          {item.productName}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div>

          {/* CARD INFERIOR: ATIVIDADE RECENTE */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
                  <Clock className="h-4 w-4" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 leading-none">
                  Atividade recente
                </h4>
              </div>
              <button
                onClick={onNavigateToMovements}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
              >
                Ver histórico
              </button>
            </div>

            {/* Lista das 4 Movimentações Recentes */}
            <div className="space-y-3 mt-4">
              {recentMovements.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  Nenhuma movimentação registrada recentemente.
                </p>
              ) : (
                recentMovements.map((m) => {
                  const isEntry = m.movement_type === 'entry';
                  const variant =
                    variants.find((v) => v.id === m.variant_id) || (m.variant as any);
                  const prod = variant?.product;
                  const sku = prod?.sku || '';
                  const prodName = prod?.name || 'Item';
                  const color = variant?.color || '';
                  const size = variant?.size || '';

                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-slate-50/80 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                            isEntry
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-rose-50 text-rose-600'
                          }`}
                        >
                          {isEntry ? (
                            <ArrowUpRight className="h-4 w-4" />
                          ) : (
                            <TrendingDown className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 leading-snug">
                            {isEntry ? 'Entrada Registrada' : 'Saída Registrada'}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[190px] sm:max-w-[240px]">
                            {sku ? `${sku} - ` : ''}
                            {prodName}{' '}
                            {color || size
                              ? `(${color}${color && size ? '/' : ''}${size})`
                              : ''}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-slate-400">
                          {formatRelativeTime(m.created_at)}
                        </div>
                        <div
                          className={`text-xs font-black mt-0.5 ${
                            isEntry ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {isEntry ? '+' : '-'} {m.quantity} un.
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Input invisível para upload de backup se necessário */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* MODAL NOVO SKU (REFERÊNCIA IMAGEM 1) */}
      {quickActionModal === 'novo_sku' && (
        <ProductCreateModal
          existingVariants={variants}
          onClose={() => setQuickActionModal(null)}
          onSuccess={(product, newVariants) => {
            if (onCreateProduct) {
              const res = onCreateProduct(product, newVariants);
              if (res && res.success === false) {
                alert(`Erro ao gravar novo SKU: ${res.error}`);
                return;
              }
            } else if (onAddVariant) {
              newVariants.forEach((v) => onAddVariant(v));
            }
            alert(
              `Produto "${product.name}" (SKU: ${product.sku}) cadastrado com sucesso com ${newVariants.length} variação(ões) com saldo ZERO!`
            );
            setQuickActionModal(null);
          }}
        />
      )}
    </div>
  );
}
