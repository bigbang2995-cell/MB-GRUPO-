'use client';

import React, { useState, useRef, useMemo } from 'react';
import { Product, ProductVariant, PendingExit, UserRole } from '@/types/database';
import { updateProductWithVariants } from '@/lib/barcode-service';
import { compressImage } from '@/lib/image-utils';
import { useAuth } from '@/contexts/AuthContext';
import { X, Plus, Archive, ArchiveRestore, AlertTriangle, Lock, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface ProductEditModalProps {
  product: Product;
  allVariants: (ProductVariant & { product?: Product })[];
  pendingExitsCount?: number;
  pendingExits?: PendingExit[];
  currentRole?: UserRole;
  onClose: () => void;
  onSuccess: (updatedProduct: Product, updatedVariants: (ProductVariant & { product: Product })[]) => void;
}

const PREDEFINED_SIZES = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2'];

export function ProductEditModal({
  product,
  allVariants,
  pendingExitsCount = 0,
  pendingExits = [],
  currentRole,
  onClose,
  onSuccess,
}: ProductEditModalProps) {
  const { user } = useAuth();
  const isAdmin = currentRole === 'admin' || user?.role === 'admin';

  // Overrides de arquivamento por variação neste formulário
  const [variantOverrides, setVariantOverrides] = useState<Record<string, Partial<ProductVariant>>>({});
  const [archivingTargetVariant, setArchivingTargetVariant] = useState<ProductVariant | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Variantes atuais deste produto
  const productVariants = useMemo(() => {
    return allVariants.filter(
      (v) => v.product_id === product.id || (v.product && v.product.sku.toLowerCase() === product.sku.toLowerCase())
    );
  }, [allVariants, product]);

  // Variantes efetivas com overrides de arquivamento aplicados
  const effectiveProductVariants = useMemo(() => {
    return productVariants.map((v) => {
      if (variantOverrides[v.id]) {
        return { ...v, ...variantOverrides[v.id] };
      }
      return v;
    });
  }, [productVariants, variantOverrides]);

  // Extração inicial de cores e tamanhos existentes
  const initialColors = useMemo(() => {
    const setC = new Set<string>();
    productVariants.forEach((v) => {
      if (v.color) setC.add(v.color.trim());
    });
    return Array.from(setC);
  }, [productVariants]);

  const initialSizes = useMemo(() => {
    const setS = new Set<string>();
    productVariants.forEach((v) => {
      if (v.size && v.size !== 'TU' && v.size !== 'UN') {
        setS.add(v.size.trim().toUpperCase());
      }
    });
    return Array.from(setS);
  }, [productVariants]);

  const initiallyHasSizes = initialSizes.length > 0;

  // Estados do formulário
  const [productName, setProductName] = useState(product.name);
  const [colors, setColors] = useState<string[]>(initialColors.length > 0 ? initialColors : ['Padrão']);
  const [sizesEnabled, setSizesEnabled] = useState(initiallyHasSizes);
  const [selectedSizes, setSelectedSizes] = useState<string[]>(
    initialSizes.length > 0 ? initialSizes : ['P', 'M', 'G']
  );
  const [customSizeInput, setCustomSizeInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(product.image_path);
  const [isCompressing, setIsCompressing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manipulação de cores
  const handleAddColor = () => {
    setColors((prev) => [...prev, '']);
  };

  const handleUpdateColor = (index: number, val: string) => {
    setColors((prev) => {
      const copy = [...prev];
      copy[index] = val;
      return copy;
    });
  };

  const handleRemoveColor = (index: number) => {
    const colorName = colors[index];
    // Verifica se existem variantes com estoque para esta cor
    const hasStock = productVariants.some(
      (v) => v.color.toLowerCase() === colorName.toLowerCase() && v.stock_quantity > 0
    );
    if (hasStock) {
      alert(`Não é possível remover a cor "${colorName}" pois existem peças em estoque.`);
      return;
    }
    if (colors.length <= 1) {
      return;
    }
    setColors((prev) => prev.filter((_, i) => i !== index));
  };

  // Manipulação de tamanhos
  const handleAddPredefinedSize = (sizeToAdd: string) => {
    if (!selectedSizes.includes(sizeToAdd)) {
      setSelectedSizes((prev) => [...prev, sizeToAdd]);
    }
  };

  const handleAddCustomSize = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = customSizeInput.trim().toUpperCase();
    if (clean && !selectedSizes.includes(clean)) {
      setSelectedSizes((prev) => [...prev, clean]);
      setCustomSizeInput('');
    }
  };

  const handleRemoveSize = (sizeToRemove: string) => {
    const hasStock = productVariants.some(
      (v) => v.size.toUpperCase() === sizeToRemove.toUpperCase() && v.stock_quantity > 0
    );
    if (hasStock) {
      alert(`Não é possível remover o tamanho "${sizeToRemove}" pois existem peças em estoque.`);
      return;
    }
    if (selectedSizes.length <= 1) return;
    setSelectedSizes((prev) => prev.filter((s) => s !== sizeToRemove));
  };

  // Upload e compressão de foto
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressing(true);
      setErrorMessage(null);
      const compressedDataUrl = await compressImage(file, 600, 600, 0.75);
      setImagePreview(compressedDataUrl);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao processar a imagem.');
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRemovePhoto = () => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Calcula estoque por cor existente
  const getColorStock = (colorName: string): number => {
    return effectiveProductVariants
      .filter((v) => v.color.trim().toLowerCase() === colorName.trim().toLowerCase())
      .reduce((sum, v) => sum + v.stock_quantity, 0);
  };

  // Ações de Arquivamento e Reativação de SKUs
  const handleInitiateArchive = (v: ProductVariant) => {
    if (!isAdmin) {
      alert('Acesso negado: apenas o Administrador pode arquivar SKUs.');
      return;
    }

    if (v.stock_quantity !== 0) {
      alert(
        `Bloqueio de Arquivamento:\nNão é permitido arquivar variação com saldo diferente de zero (saldo atual: ${v.stock_quantity} un).\nZere o estoque físico antes de prosseguir com o arquivamento.`
      );
      return;
    }

    const hasPending = pendingExits.some((e) => e.variantId === v.id && e.quantity > 0);
    if (hasPending) {
      alert(
        `Bloqueio de Arquivamento:\nExistem saídas pendentes registradas para esta variação no sistema.\nConclua ou cancele as saídas pendentes antes de arquivar o SKU.`
      );
      return;
    }

    setArchivingTargetVariant(v);
    setArchiveReason('');
    setArchiveError(null);
  };

  const handleConfirmArchive = () => {
    if (!archivingTargetVariant) return;

    const cleanReason = archiveReason.trim();
    if (!cleanReason || cleanReason.length < 3) {
      setArchiveError('Informe o motivo do arquivamento (mínimo de 3 caracteres).');
      return;
    }

    setVariantOverrides((prev) => ({
      ...prev,
      [archivingTargetVariant.id]: {
        is_archived: true,
        archived_at: new Date().toISOString(),
        archived_by: user?.id || 'usr-admin-demo',
        archived_by_name: user?.name || 'Administrador',
        archived_reason: cleanReason,
      },
    }));

    setArchivingTargetVariant(null);
    setArchiveReason('');
    setArchiveError(null);
  };

  const handleReactivateVariant = (v: ProductVariant) => {
    if (!isAdmin) {
      alert('Acesso negado: apenas o Administrador pode reativar SKUs.');
      return;
    }

    const confirmed = window.confirm(
      `Deseja reativar a variação "${v.color} - ${v.size}" (${v.barcode})?\nEla voltará a ficar disponível para leituras de código de barras e movimentações operacionais.`
    );
    if (!confirmed) return;

    setVariantOverrides((prev) => ({
      ...prev,
      [v.id]: {
        is_archived: false,
        archived_at: null,
        archived_by: null,
        archived_by_name: null,
        archived_reason: null,
      },
    }));
  };

  // Salvar edições
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!productName.trim()) {
      setErrorMessage('O Nome do produto é obrigatório.');
      return;
    }

    const cleanColors = colors.map((c) => c.trim()).filter((c) => c.length > 0);
    if (cleanColors.length === 0) {
      setErrorMessage('Informe ao menos uma cor.');
      return;
    }

    if (sizesEnabled && selectedSizes.length === 0) {
      setErrorMessage('Selecione ao menos um tamanho.');
      return;
    }

    const effectiveAllVariants = allVariants.map((v) => {
      if (variantOverrides[v.id]) {
        return { ...v, ...variantOverrides[v.id] };
      }
      return v;
    });

    try {
      const result = updateProductWithVariants({
        existingProduct: product,
        newName: productName,
        imagePath: imagePreview,
        newColors: cleanColors,
        newSizes: selectedSizes,
        sizesEnabled,
        allVariants: effectiveAllVariants,
      });

      onSuccess(result.updatedProduct, result.updatedVariants);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao atualizar produto.');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 my-8">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Editar produto</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Altere dados, cores e estoque deste SKU.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Topo em 2 Colunas: SKU Oficial e Nome do Produto */}
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                SKU *
              </label>
              <input
                type="text"
                value={product.sku}
                disabled
                title="O SKU oficial é imutável para garantir integridade fiscal e de etiquetas"
                className="w-full px-3.5 py-2.5 text-sm bg-slate-100 border border-slate-200 rounded-xl font-mono text-slate-600 font-bold cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nome do produto *
              </label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Ex.: Calça de couro pantalona"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Cores e estoque */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Cores e estoque *
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2">
              <div className="grid grid-cols-[1fr_80px_36px] gap-2 px-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <span>Cor</span>
                <span className="text-center">Quantidade</span>
                <span />
              </div>

              {colors.map((colorVal, idx) => {
                const stock = getColorStock(colorVal);
                return (
                  <div key={idx} className="grid grid-cols-[1fr_80px_36px] gap-2 items-center">
                    <input
                      type="text"
                      value={colorVal}
                      onChange={(e) => handleUpdateColor(idx, e.target.value)}
                      placeholder="Ex.: preta"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                    <input
                      type="text"
                      value={stock}
                      disabled
                      title="Soma de estoque das variações desta cor"
                      className="w-full px-2 py-2 text-xs font-mono text-center bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-bold cursor-not-allowed"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveColor(idx)}
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 text-rose-500 hover:bg-rose-50 hover:border-rose-300 transition-colors"
                      title="Remover cor"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={handleAddColor}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar cor
              </button>

              <span className="text-xs text-slate-500">
                {pendingExitsCount > 0
                  ? `${pendingExitsCount} saída(s) pendente(s) neste SKU`
                  : 'Nenhuma saída pendente neste SKU'}
              </span>
            </div>
          </div>

          {/* Opção: Este produto possui tamanhos */}
          <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/30">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-900 block">
                  Este produto possui tamanhos
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  Ative somente para peças que precisam de controle por tamanho.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSizesEnabled(!sizesEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  sizesEnabled ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    sizesEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Painel de Tamanhos */}
            {sizesEnabled && (
              <div className="mt-4 pt-3 border-t border-slate-200 space-y-3">
                {/* Tamanhos ativos chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedSizes.map((sz) => (
                    <span
                      key={sz}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold"
                    >
                      {sz}
                      <button
                        type="button"
                        onClick={() => handleRemoveSize(sz)}
                        className="hover:text-blue-900 cursor-pointer text-sm"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={customSizeInput}
                      onChange={(e) => setCustomSizeInput(e.target.value)}
                      placeholder="EX.: XG"
                      className="w-20 px-2 py-1 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddCustomSize()}
                      className="px-2.5 py-1 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-2xs"
                    >
                      + Tamanho
                    </button>
                  </div>
                </div>

                {/* Seletores rápidos predefinidos */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-slate-400">Atalhos:</span>
                  {PREDEFINED_SIZES.map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => handleAddPredefinedSize(sz)}
                      disabled={selectedSizes.includes(sz)}
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border transition-colors ${
                        selectedSizes.includes(sz)
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 cursor-pointer'
                      }`}
                    >
                      +{sz}
                    </button>
                  ))}
                </div>

                {/* Matriz Dinâmica de Cores x Tamanhos */}
                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                      <tr>
                        <th className="px-3 py-2">Cor</th>
                        {selectedSizes.map((sz) => (
                          <th key={sz} className="px-2 py-2 text-center">
                            {sz}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right">Soma / estoque</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-mono text-[11px]">
                      {colors
                        .filter((c) => c.trim().length > 0)
                        .map((c, cIdx) => {
                          const rowVariants = productVariants.filter(
                            (v) => v.color.trim().toLowerCase() === c.trim().toLowerCase()
                          );
                          const totalColorStock = rowVariants.reduce((a, b) => a + b.stock_quantity, 0);

                          return (
                            <tr key={cIdx} className="hover:bg-slate-50/50">
                              <td className="px-3 py-2 font-sans font-semibold text-slate-900">
                                {c}
                              </td>
                              {selectedSizes.map((sz) => {
                                const variantForCell = rowVariants.find(
                                  (v) => v.size.trim().toUpperCase() === sz.trim().toUpperCase()
                                );
                                const qty = variantForCell ? variantForCell.stock_quantity : 0;
                                return (
                                  <td key={sz} className="px-2 py-2 text-center">
                                    <span
                                      className={`px-2 py-1 rounded-md text-xs font-mono font-bold ${
                                        variantForCell
                                          ? 'bg-slate-100 text-slate-800'
                                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      }`}
                                      title={variantForCell ? `Código: ${variantForCell.barcode}` : 'Nova variação (saldo 0)'}
                                    >
                                      {qty}
                                    </span>
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-right font-bold text-emerald-700">
                                {totalColorStock} / {totalColorStock}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-slate-500 italic">
                  Distribua o estoque total de cada cor entre os tamanhos. Novas combinações serão criadas com saldo 0.
                </p>
              </div>
            )}
          </div>

          {/* GESTÃO E ARQUIVAMENTO DE SKUS (EXCLUSIVO ADMINISTRADOR) */}
          <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/40 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Archive className="h-4 w-4 text-slate-700" />
                  Variações & Arquivamento de SKUs
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  Variações com saldo 0 podem ser arquivadas para não aparecerem nas operações comuns de estoque e bipagem. Códigos de barras e histórico permanecem preservados (imutáveis).
                </span>
              </div>
              <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded-full shrink-0">
                {effectiveProductVariants.filter((v) => !v.is_archived).length} ativas / {effectiveProductVariants.filter((v) => v.is_archived).length} arquivadas
              </span>
            </div>

            <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {effectiveProductVariants.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  Nenhuma variação cadastrada para este produto.
                </div>
              ) : (
                effectiveProductVariants.map((v) => {
                  const isArchived = Boolean(v.is_archived);
                  const hasStock = (v.stock_quantity || 0) !== 0;
                  const hasPending = pendingExits.some((e) => e.variantId === v.id && e.quantity > 0);
                  const canArchive = isAdmin && !isArchived && !hasStock && !hasPending;

                  return (
                    <div
                      key={v.id}
                      className={`p-3 flex items-center justify-between gap-3 text-xs ${
                        isArchived ? 'bg-slate-50/70 opacity-80' : 'hover:bg-slate-50/40'
                      }`}
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">
                            {v.color} • {v.size}
                          </span>
                          <span className="font-mono text-[11px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            {v.barcode || v.id}
                          </span>
                          {isArchived ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              <Archive className="h-3 w-3" />
                              Arquivado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="h-3 w-3" />
                              Ativo
                            </span>
                          )}
                        </div>

                        {isArchived ? (
                          <p className="text-[11px] text-slate-500 italic">
                            Motivo: {v.archived_reason || 'Descontinuado'}
                            {v.archived_by_name ? ` • Por: ${v.archived_by_name}` : ''}
                            {v.archived_at ? ` • Em: ${new Date(v.archived_at).toLocaleDateString('pt-BR')}` : ''}
                          </p>
                        ) : (
                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            <span>
                              Saldo físico:{' '}
                              <strong className={v.stock_quantity > 0 ? 'text-slate-900' : 'text-rose-600'}>
                                {v.stock_quantity} un
                              </strong>
                            </span>
                            {hasPending && (
                              <span className="text-amber-600 font-semibold">• Possui saídas pendentes</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {isArchived ? (
                          isAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleReactivateVariant(v)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-bold text-xs shadow-2xs transition-colors cursor-pointer"
                              title="Reativar SKU para operações de estoque"
                            >
                              <ArchiveRestore className="h-3.5 w-3.5 text-blue-600" />
                              Reativar SKU
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">Arquivado</span>
                          )
                        ) : (
                          isAdmin && (
                            <button
                              type="button"
                              disabled={!canArchive}
                              onClick={() => handleInitiateArchive(v)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs shadow-2xs transition-colors ${
                                canArchive
                                  ? 'border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 cursor-pointer'
                                  : 'border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                              }`}
                              title={
                                hasStock
                                  ? `Bloqueado: Saldo atual é de ${v.stock_quantity} un (deve ser 0 para arquivar)`
                                  : hasPending
                                  ? 'Bloqueado: Existem saídas pendentes para este SKU'
                                  : 'Arquivar este SKU com saldo zero'
                              }
                            >
                              <Archive className="h-3.5 w-3.5" />
                              Arquivar SKU
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* FOTO DO PRODUTO */}
          <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/30">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
              FOTO DO PRODUTO
            </label>

            <div className="flex items-center gap-3.5">
              <div className="h-16 w-16 shrink-0 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shadow-2xs">
                {imagePreview ? (
                  <img src={imagePreview} alt="Foto do Produto" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] font-black text-slate-400 tracking-tight text-center">
                    SEM FOTO
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCompressing}
                    className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    {isCompressing ? 'Comprimindo...' : 'Mudar foto'}
                  </button>
                  {imagePreview && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="text-xs font-bold text-rose-600 hover:text-rose-800 transition-colors cursor-pointer"
                    >
                      Remover foto
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-slate-400">
                  A nova foto aparece no Estoque, Registrar saídas e Configurações.
                </p>
              </div>
            </div>
          </div>

          {/* Botões do Rodapé */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 text-xs font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 shadow-xs transition-colors cursor-pointer"
            >
              Salvar alterações
            </button>
          </div>
        </form>
      </div>

      {/* Modal de Confirmação Obrigatória de Arquivamento de SKU */}
      {archivingTargetVariant && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
                <Archive className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Confirmar Arquivamento de SKU
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Esta ação retira a variação das operações de bipagem e estoque, preservando o histórico de movimentações e o código de barras (anti-reciclagem).
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <p>
                <strong className="text-slate-700">Produto:</strong> {product.name}
              </p>
              <p>
                <strong className="text-slate-700">Variação:</strong> {archivingTargetVariant.color} • {archivingTargetVariant.size}
              </p>
              <p>
                <strong className="text-slate-700">Código de Barras:</strong>{' '}
                <code className="font-mono font-bold">{archivingTargetVariant.barcode || archivingTargetVariant.id}</code>
              </p>
              <p>
                <strong className="text-slate-700">Saldo Atual:</strong>{' '}
                <span className="font-bold text-emerald-700">{archivingTargetVariant.stock_quantity} un</span>
              </p>
            </div>

            {archiveError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-semibold">
                {archiveError}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Motivo do Arquivamento *
              </label>
              <input
                type="text"
                autoFocus
                value={archiveReason}
                onChange={(e) => {
                  setArchiveReason(e.target.value);
                  setArchiveError(null);
                }}
                placeholder="Ex.: Descontinuação da cor pelo fornecedor"
                className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                O motivo e o responsável ({user?.name || 'Administrador'}) ficarão registrados para auditoria.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setArchivingTargetVariant(null);
                  setArchiveReason('');
                  setArchiveError(null);
                }}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmArchive}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 rounded-xl hover:bg-amber-700 transition-colors cursor-pointer shadow-xs"
              >
                Confirmar Arquivamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

