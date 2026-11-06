/**
 * MB GRUPO — SERVIÇO UNIVERSAL DE CÓDIGOS DE BARRAS (V30)
 *
 * Módulo centralizado para:
 * 1. Resolução universal de leituras (USB MDK-104, teclado ABNT2, scanner manual)
 * 2. Geração determinística de novos SKUs e variações conforme o padrão oficial V30
 * 3. Validação óptica Code 128 e prevenção de colisões
 * 4. Compatibilidade integral com EAN-13 numérico, Code 128 e Catálogo V30
 */

import { Product, ProductVariant } from '@/types/database';
import { encodeCode128 } from './code128';

export type ProductVariantWithProduct = ProductVariant & { product?: Product };

export type BarcodeMatchType =
  | 'exact'
  | 'case_insensitive'
  | 'normalized_semicolon';

export type BarcodeErrorCode =
  | 'EMPTY_CODE'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_MATCH'
  | 'INACTIVE_PRODUCT'
  | 'ARCHIVED_SKU';

export interface BarcodeResolutionResult<T extends ProductVariant = ProductVariantWithProduct> {
  success: boolean;
  matchedVariant?: T;
  rawInput: string;
  normalizedCode?: string;
  matchType?: BarcodeMatchType;
  wasNormalized: boolean;
  error?: BarcodeErrorCode;
  errorMessage?: string;
}

export interface GeneratedVariantData {
  variantId: string;
  barcode: string;
  sku: string;
  productName: string;
  color: string;
  size: string;
  isUnique: boolean;
  code128Valid: boolean;
}

/**
 * Normaliza o SKU base removendo prefixos redundantes (ex: 'MB-0011' -> '0011')
 */
export function extractBaseSku(rawSku: string): {
  cleanSku: string;
  upperSku: string;
  lowerSku: string;
} {
  let clean = (rawSku || '').trim();
  // Se começar com "MB-" ou "MB", remove o prefixo MB para evitar "MB-MB-XXXX"
  clean = clean.replace(/^MB-?/i, '');
  return {
    cleanSku: clean,
    upperSku: clean.toUpperCase(),
    lowerSku: clean.toLowerCase(),
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. RESOLUÇÃO UNIVERSAL DE CÓDIGOS DE BARRAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Utilizada por TODOS os módulos (Bipagem, Saídas, Lotes, Conferência, Leitura Manual/USB):
 *
 * Pipeline Estrito:
 * 1. Limpeza e trim do código recebido.
 * 2. Tenta correspondência EXATA com o código oficial cadastrado (preserva EAN-13 numérico e Code 128).
 * 3. Se não encontrar, tenta correspondência insensível a maiúsculas/minúsculas.
 * 4. Se não encontrar e o texto contiver ';', testa a normalização de ';' para '-'
 *    (soluciona o mapa de teclado ABNT2 do scanner Tomate MDK-104).
 * 5. Rejeita códigos ambíguos (>1 match) ou inexistentes.
 * 6. Não altera caracteres indiscriminadamente em códigos válidos.
 */
export function resolveScannedBarcode<T extends ProductVariant>(
  rawInput: string,
  variants: T[]
): BarcodeResolutionResult<T> {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      success: false,
      rawInput: rawInput || '',
      wasNormalized: false,
      error: 'EMPTY_CODE',
      errorMessage: 'Código de barras não informado.',
    };
  }

  const cleanInput = rawInput.trim();
  if (cleanInput.length === 0) {
    return {
      success: false,
      rawInput,
      wasNormalized: false,
      error: 'EMPTY_CODE',
      errorMessage: 'Código de barras vazio.',
    };
  }

  const createMatchResult = (
    matched: T,
    matchType: BarcodeMatchType,
    wasNormalized: boolean
  ): BarcodeResolutionResult<T> => {
    if (matched.is_archived) {
      return {
        success: false,
        matchedVariant: matched,
        rawInput,
        normalizedCode: matched.barcode || matched.id,
        matchType,
        wasNormalized,
        error: 'ARCHIVED_SKU',
        errorMessage: `O SKU "${matched.barcode || matched.id}" está arquivado e indisponível para operações de estoque.`,
      };
    }

    return {
      success: true,
      matchedVariant: matched,
      rawInput,
      normalizedCode: matched.barcode || matched.id,
      matchType,
      wasNormalized,
    };
  };

  // PASS 1: Correspondência Exata (Sensível a Maiúsculas/Minúsculas)
  const exactMatches = variants.filter(
    (v) => (v.barcode && v.barcode === cleanInput) || v.id === cleanInput
  );

  if (exactMatches.length === 1) {
    return createMatchResult(exactMatches[0], 'exact', false);
  }

  if (exactMatches.length > 1) {
    return {
      success: false,
      rawInput,
      wasNormalized: false,
      error: 'AMBIGUOUS_MATCH',
      errorMessage: `Ambiguidade detectada: existem ${exactMatches.length} itens cadastrados com este código exato.`,
    };
  }

  // PASS 2: Correspondência Insensível a Maiúsculas/Minúsculas
  const lowerInput = cleanInput.toLowerCase();
  const caseMatches = variants.filter(
    (v) =>
      (v.barcode && v.barcode.toLowerCase() === lowerInput) ||
      v.id.toLowerCase() === lowerInput
  );

  if (caseMatches.length === 1) {
    return createMatchResult(caseMatches[0], 'case_insensitive', false);
  }

  if (caseMatches.length > 1) {
    return {
      success: false,
      rawInput,
      wasNormalized: false,
      error: 'AMBIGUOUS_MATCH',
      errorMessage: `Ambiguidade detectada: existem ${caseMatches.length} itens com variações de maiúsculas/minúsculas para este código.`,
    };
  }

  // PASS 3: Normalização de Ponto e Vírgula (Tomate MDK-104 / Teclado ABNT2)
  // Regra fundamental: Apenas acionado se a entrada contiver ';'
  if (cleanInput.includes(';')) {
    const candidateHyphen = cleanInput.replace(/;/g, '-');
    const candidateLower = candidateHyphen.toLowerCase();

    // 3a. Tenta match exato com hífen substituído
    let hyphenMatches = variants.filter(
      (v) =>
        (v.barcode && v.barcode === candidateHyphen) ||
        v.id === candidateHyphen
    );

    // 3b. Se não encontrou exato com hífen, tenta case-insensitive
    if (hyphenMatches.length === 0) {
      hyphenMatches = variants.filter(
        (v) =>
          (v.barcode && v.barcode.toLowerCase() === candidateLower) ||
          v.id.toLowerCase() === candidateLower
      );
    }

    if (hyphenMatches.length === 1) {
      return createMatchResult(hyphenMatches[0], 'normalized_semicolon', true);
    }

    if (hyphenMatches.length > 1) {
      return {
        success: false,
        rawInput,
        wasNormalized: true,
        error: 'AMBIGUOUS_MATCH',
        errorMessage: `Ambiguidade na normalização de ponto e vírgula: ${hyphenMatches.length} itens encontrados para "${candidateHyphen}".`,
      };
    }
  }

  // PASS 4: Código Inexistente
  return {
    success: false,
    rawInput,
    wasNormalized: false,
    error: 'NOT_FOUND',
    errorMessage: `Código de barras não cadastrado: "${cleanInput}".`,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. GERAÇÃO DETERMINÍSTICA DE CÓDIGOS PARA O BOTÃO "NOVO SKU"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Identificação do padrão oficial do Catálogo V30:
 * - Produto: prod-<sku_lower> (ex: prod-0011, prod-cj-889)
 * - Variação: var-<sku_lower>-<index_2digits> (ex: var-0011-06)
 * - Código de Barras: MB-<sku_upper>-<index_2digits> (ex: MB-0011-06)
 *
 * Prevenção de Colisões:
 * - Varre todas as variantes ativas em memória
 * - Identifica o maior índice sequencial do SKU (ex: se já existem 01..05, gera 06)
 * - Verifica se não há colisão com nenhum outro barcode ou ID cadastrado
 * - Se houver colisão de barcode existente, continua incrementando até achar código único
 * - Valida a codificação com a tabela Code 128 (Subset B)
 */
export function generateNextVariantCode(params: {
  productSku: string;
  productName: string;
  color: string;
  size: string;
  existingVariants: (ProductVariant & { product?: Product })[];
}): GeneratedVariantData {
  const { productSku, productName, color, size, existingVariants } = params;
  const { upperSku, lowerSku } = extractBaseSku(productSku);

  if (!upperSku) {
    throw new Error('SKU Base não pode ser vazio para geração de código de barras.');
  }

  // Mapeia todos os barcodes e IDs existentes para garantir unicidade estrita
  const existingBarcodes = new Set<string>();
  const existingIds = new Set<string>();
  let maxIndex = 0;

  for (const v of existingVariants) {
    if (v.barcode) existingBarcodes.add(v.barcode.toUpperCase());
    if (v.id) existingIds.add(v.id.toLowerCase());

    // Verifica índice pelo barcode: MB-<SKU>-<NN>
    const barcodeStr = v.barcode || '';
    const prefixExpected = `MB-${upperSku}-`;
    if (barcodeStr.toUpperCase().startsWith(prefixExpected)) {
      const suffix = barcodeStr.slice(prefixExpected.length);
      const parsedNum = parseInt(suffix, 10);
      if (!isNaN(parsedNum) && parsedNum > maxIndex) {
        maxIndex = parsedNum;
      }
    }

    // Verifica índice pelo variant id: var-<sku>-<NN>
    const idExpected = `var-${lowerSku}-`;
    if (v.id.toLowerCase().startsWith(idExpected)) {
      const suffix = v.id.slice(idExpected.length);
      const parsedNum = parseInt(suffix, 10);
      if (!isNaN(parsedNum) && parsedNum > maxIndex) {
        maxIndex = parsedNum;
      }
    }
  }

  // Incrementa para o próximo índice livre
  let candidateIndex = maxIndex + 1;
  let candidateBarcode = '';
  let candidateId = '';

  while (true) {
    const formattedIndex = String(candidateIndex).padStart(2, '0');
    candidateBarcode = `MB-${upperSku}-${formattedIndex}`;
    candidateId = `var-${lowerSku}-${formattedIndex}`;

    const barcodeCollides = existingBarcodes.has(candidateBarcode.toUpperCase());
    const idCollides = existingIds.has(candidateId.toLowerCase());

    if (!barcodeCollides && !idCollides) {
      break;
    }
    candidateIndex++;
  }

  // Validação óptica Code 128
  let code128Valid = true;
  try {
    const encoded = encodeCode128(candidateBarcode);
    code128Valid = Boolean(encoded && encoded.bars.length > 0);
  } catch {
    code128Valid = false;
  }

  return {
    variantId: candidateId,
    barcode: candidateBarcode,
    sku: upperSku,
    productName: productName.trim() || `Produto ${upperSku}`,
    color: color.trim() || 'Padrão',
    size: size.trim() || 'M',
    isUnique: true,
    code128Valid,
  };
}

/**
 * Cria um objeto completo de variante em memória compatível com o Catálogo V30,
 * pronto para inserção no estado local do dashboard e geração de etiquetas térmicas.
 */
export function createMemoryVariant(params: {
  productSku: string;
  productName: string;
  color: string;
  size: string;
  customBarcode?: string;
  initialStock?: number;
  existingVariants: ProductVariantWithProduct[];
  imagePath?: string | null;
}): {
  variant: ProductVariant & { product: Product };
  isNewProduct: boolean;
  generatedBarcode: string;
} {
  const { upperSku, lowerSku } = extractBaseSku(params.productSku);

  // Procura se o produto já existe em alguma variante existente
  const existingVariantWithProduct = params.existingVariants.find(
    (v) => v.product && extractBaseSku(v.product.sku).upperSku === upperSku
  );

  const isNewProduct = !existingVariantWithProduct;

  // Gera dados oficiais determinísticos
  const generated = generateNextVariantCode({
    productSku: upperSku,
    productName:
      params.productName ||
      existingVariantWithProduct?.product?.name ||
      `Produto ${upperSku}`,
    color: params.color,
    size: params.size,
    existingVariants: params.existingVariants,
  });

  // Código de barras final: se fornecido manualmente, valida colisão; senão usa o oficial gerado
  let finalBarcode = generated.barcode;
  if (params.customBarcode && params.customBarcode.trim().length > 0) {
    const customTrimmed = params.customBarcode.trim();
    const collides = params.existingVariants.some(
      (v) => v.barcode && v.barcode.toLowerCase() === customTrimmed.toLowerCase()
    );
    if (collides) {
      throw new Error(`Código de barras "${customTrimmed}" já está cadastrado para outra peça.`);
    }
    finalBarcode = customTrimmed;
  }

  const product: Product = existingVariantWithProduct?.product || {
    id: `prod-${lowerSku}`,
    sku: upperSku,
    name: (params.productName || `Produto ${upperSku}`).trim(),
    image_path: params.imagePath || null,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const variant: ProductVariant & { product: Product } = {
    id: generated.variantId,
    product_id: product.id,
    color: generated.color,
    size: generated.size,
    barcode: finalBarcode,
    stock_quantity: Math.max(0, Number(params.initialStock) || 0),
    created_at: new Date().toISOString(),
    product,
  };

  return {
    variant,
    isNewProduct,
    generatedBarcode: finalBarcode,
  };
}

/**
 * Cria um novo produto completo com suas respectivas cores e tamanhos em matriz,
 * gerando códigos de barras oficiais Code 128 únicos.
 * REGRA OBRIGATÓRIA: Todas as novas variantes iniciam com saldo ZERO (0).
 */
export function createProductWithVariants(params: {
  productSku: string;
  productName: string;
  colors: string[];
  sizes: string[];
  sizesEnabled: boolean;
  imagePath?: string | null;
  existingVariants: ProductVariantWithProduct[];
}): {
  product: Product;
  variants: (ProductVariant & { product: Product })[];
} {
  const { upperSku, lowerSku } = extractBaseSku(params.productSku);
  if (!upperSku) {
    throw new Error('SKU Base é obrigatório.');
  }

  // Verifica colisão de produto com SKU já existente
  const skuCollides = params.existingVariants.some(
    (v) => v.product && extractBaseSku(v.product.sku).upperSku === upperSku
  );
  if (skuCollides) {
    throw new Error(`O SKU "${upperSku}" já está cadastrado no catálogo.`);
  }

  const product: Product = {
    id: `prod-${lowerSku}`,
    sku: upperSku,
    name: params.productName.trim(),
    image_path: params.imagePath || null,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Cores válidas (remover vazias e duplicadas)
  const cleanColors = Array.from(
    new Set(params.colors.map((c) => c.trim()).filter((c) => c.length > 0))
  );
  if (cleanColors.length === 0) {
    cleanColors.push('Padrão');
  }

  // Tamanhos válidos
  let effectiveSizes: string[] = ['TU'];
  if (params.sizesEnabled) {
    const cleanSizes = Array.from(
      new Set(params.sizes.map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0))
    );
    effectiveSizes = cleanSizes.length > 0 ? cleanSizes : ['M'];
  }

  const generatedVariants: (ProductVariant & { product: Product })[] = [];
  const accumulatedVariants: ProductVariantWithProduct[] = [...params.existingVariants];

  // Matriz de cores x tamanhos
  for (const color of cleanColors) {
    for (const size of effectiveSizes) {
      const generated = generateNextVariantCode({
        productSku: upperSku,
        productName: product.name,
        color,
        size,
        existingVariants: accumulatedVariants,
      });

      const variant: ProductVariant & { product: Product } = {
        id: generated.variantId,
        product_id: product.id,
        color: generated.color,
        size: generated.size,
        barcode: generated.barcode,
        stock_quantity: 0, // REGRA OBRIGATÓRIA: SALDO ZERO
        created_at: new Date().toISOString(),
        product,
      };

      generatedVariants.push(variant);
      accumulatedVariants.push(variant);
    }
  }

  return {
    product,
    variants: generatedVariants,
  };
}

/**
 * Atualiza um produto existente (nome, foto) e incorpora novas cores ou tamanhos à grade.
 * - Preserva códigos de barras, IDs e saldos das variantes já existentes.
 * - Novas variantes geradas iniciam obrigatoriamente com saldo ZERO (0).
 */
export function updateProductWithVariants(params: {
  existingProduct: Product;
  newName: string;
  imagePath?: string | null;
  newColors: string[];
  newSizes: string[];
  sizesEnabled: boolean;
  allVariants: ProductVariantWithProduct[];
}): {
  updatedProduct: Product;
  updatedVariants: (ProductVariant & { product: Product })[];
  addedVariantsCount: number;
} {
  const { upperSku } = extractBaseSku(params.existingProduct.sku);

  const updatedProduct: Product = {
    ...params.existingProduct,
    name: params.newName.trim() || params.existingProduct.name,
    image_path: params.imagePath !== undefined ? params.imagePath : params.existingProduct.image_path,
    updated_at: new Date().toISOString(),
  };

  // Cores fornecidas
  const cleanColors = Array.from(
    new Set(params.newColors.map((c) => c.trim()).filter((c) => c.length > 0))
  );
  if (cleanColors.length === 0) {
    cleanColors.push('Padrão');
  }

  // Tamanhos
  let effectiveSizes: string[] = ['TU'];
  if (params.sizesEnabled) {
    const cleanSizes = Array.from(
      new Set(params.newSizes.map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0))
    );
    effectiveSizes = cleanSizes.length > 0 ? cleanSizes : ['M'];
  }

  // Separa as variantes pertencentes a este produto e as demais
  const otherVariants: (ProductVariant & { product: Product })[] = [];
  const existingProductVariants: (ProductVariant & { product: Product })[] = [];

  params.allVariants.forEach((v) => {
    const isThisProduct =
      v.product_id === params.existingProduct.id ||
      (v.product && extractBaseSku(v.product.sku).upperSku === upperSku);

    if (isThisProduct) {
      existingProductVariants.push({
        ...v,
        product: updatedProduct,
      });
    } else {
      otherVariants.push(v as ProductVariant & { product: Product });
    }
  });

  const finalProductVariants: (ProductVariant & { product: Product })[] = [...existingProductVariants];
  const accumulatedVariants: ProductVariantWithProduct[] = [...params.allVariants];
  let addedCount = 0;

  // Para cada par (color x size), verifica se já existe; se não, gera novo com saldo ZERO
  for (const color of cleanColors) {
    for (const size of effectiveSizes) {
      const alreadyExists = finalProductVariants.some(
        (v) => v.color.trim().toLowerCase() === color.trim().toLowerCase() && v.size.trim().toUpperCase() === size.trim().toUpperCase()
      );

      if (!alreadyExists) {
        const generated = generateNextVariantCode({
          productSku: upperSku,
          productName: updatedProduct.name,
          color,
          size,
          existingVariants: accumulatedVariants,
        });

        const newVariant: ProductVariant & { product: Product } = {
          id: generated.variantId,
          product_id: updatedProduct.id,
          color: generated.color,
          size: generated.size,
          barcode: generated.barcode,
          stock_quantity: 0, // REGRA OBRIGATÓRIA: SALDO ZERO
          created_at: new Date().toISOString(),
          product: updatedProduct,
        };

        finalProductVariants.push(newVariant);
        accumulatedVariants.push(newVariant);
        addedCount++;
      }
    }
  }

  return {
    updatedProduct,
    updatedVariants: [...finalProductVariants, ...otherVariants],
    addedVariantsCount: addedCount,
  };
}
