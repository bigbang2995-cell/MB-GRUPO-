/**
 * Gerador de PDF Vetorial de Alta Precisão para Rolo Térmico MB Grupo
 * Padrão LabelPrinter 4xx (200 DPI / 8 dots por mm)
 *
 * Mídia: Rolo contínuo de 2 colunas (2 carreiras)
 * Dimensões por etiqueta: 40 mm (largura) × 30 mm (altura)
 * Dimensões por par (linha): 82 mm (largura) × 30 mm (altura)
 * - Etiqueta Esquerda: X = 0 mm (até X = 40 mm)
 * - Espaçamento horizontal (Gap): 2 mm (de X = 40 mm até X = 42 mm)
 * - Etiqueta Direita: X = 42 mm (até X = 82 mm)
 *
 * Cada página do PDF representa exatamente 1 par de etiquetas físicas no rolo.
 * Sem margens extras, escala 100% real, compatível com sensor de gap térmico.
 */

import { encodeCode128 } from './code128';

export interface LabelPrintItem {
  id: string;
  productName: string;
  sku: string;
  color: string;
  size: string;
  barcode: string;
  pairsCount?: number; // Quantidade de pares (cada par = 2 etiquetas idênticas)
}

export interface LabelPrintOptions {
  labelWidthMm?: number; // Padrão: 40 mm
  labelHeightMm?: number; // Padrão: 30 mm
  horizontalGapMm?: number; // Padrão: 2 mm
  leftMarginMm?: number; // Padrão: 0 mm
  verticalGapMm?: number; // Padrão: 3 mm (espaçamento vertical entre linhas no rolo)
}

const MM_TO_PT = 72 / 25.4; // 2.834645669291339 pt por mm

/**
 * Converte string para formato seguro WinAnsi/ASCII com suporte a acentos
 */
function sanitizeText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Converte caracteres acentuados para compatibilidade estrita com impressoras térmicas
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Gera o buffer binário de um arquivo PDF (ISO 32000-1) com dimensões exatas de 82mm x 30mm
 */
export function generateLabelsPdf(
  items: LabelPrintItem[],
  options: LabelPrintOptions = {}
): Uint8Array {
  const labelWidthMm = options.labelWidthMm ?? 40;
  const labelHeightMm = options.labelHeightMm ?? 30;
  const horizontalGapMm = options.horizontalGapMm ?? 2;
  const leftMarginMm = options.leftMarginMm ?? 0;

  // Largura total da linha (82mm por padrão) e altura da linha (30mm)
  const totalRowWidthMm = leftMarginMm + labelWidthMm + horizontalGapMm + labelWidthMm;
  const pageWidthPt = totalRowWidthMm * MM_TO_PT;
  const pageHeightPt = labelHeightMm * MM_TO_PT;

  const pages: string[] = [];

  // Itera sobre os itens gerando 1 página por par de etiquetas solicitado
  items.forEach((item) => {
    const pairsToPrint = Math.max(1, item.pairsCount || 1);

    for (let p = 0; p < pairsToPrint; p++) {
      const streamOps: string[] = [];

      // Posições X das duas etiquetas idênticas: Esquerda e Direita
      const leftLabelXMm = leftMarginMm;
      const rightLabelXMm = leftMarginMm + labelWidthMm + horizontalGapMm;

      [leftLabelXMm, rightLabelXMm].forEach((labelXMm) => {
        const labelXPt = labelXMm * MM_TO_PT;

        // 1. Linha divisória do cabeçalho
        const lineYPt = 25.8 * MM_TO_PT;
        streamOps.push(`0.5 w 0 0 0 RG`);
        streamOps.push(
          `${(labelXPt + 2 * MM_TO_PT).toFixed(2)} ${lineYPt.toFixed(2)} m ${(
            labelXPt + 38 * MM_TO_PT
          ).toFixed(2)} ${lineYPt.toFixed(2)} l S`
        );

        // 2. Caixa preta "MB" e texto
        const mbBoxXPt = labelXPt + 2 * MM_TO_PT;
        const mbBoxYPt = 26.3 * MM_TO_PT;
        const mbBoxWPt = 3.6 * MM_TO_PT;
        const mbBoxHPt = 2.5 * MM_TO_PT;
        streamOps.push(
          `0 0 0 rg ${mbBoxXPt.toFixed(2)} ${mbBoxYPt.toFixed(2)} ${mbBoxWPt.toFixed(
            2
          )} ${mbBoxHPt.toFixed(2)} re f`
        );

        // Texto branco "MB"
        streamOps.push(
          `1 1 1 rg BT /F1 5 Tf ${(mbBoxXPt + 0.6 * MM_TO_PT).toFixed(2)} ${(
            mbBoxYPt + 0.6 * MM_TO_PT
          ).toFixed(2)} Td (MB) Tj ET 0 0 0 rg`
        );

        // Texto "MB GRUPO"
        streamOps.push(
          `0 0 0 rg BT /F1 5.5 Tf ${(labelXPt + 6.2 * MM_TO_PT).toFixed(2)} ${(
            mbBoxYPt + 0.6 * MM_TO_PT
          ).toFixed(2)} Td (MB GRUPO) Tj ET`
        );

        // SKU da peça à direita
        const skuStr = sanitizeText(item.sku || '');
        const skuApproxWidthPt = skuStr.length * 3.4;
        const skuXPt = labelXPt + 38 * MM_TO_PT - skuApproxWidthPt;
        streamOps.push(
          `BT /F1 5.5 Tf ${skuXPt.toFixed(2)} ${(mbBoxYPt + 0.6 * MM_TO_PT).toFixed(
            2
          )} Td (${skuStr}) Tj ET`
        );

        // 3. Nome do Produto (máximo 25 caracteres para não vazar a borda)
        const prodName = sanitizeText(item.productName || '')
          .toUpperCase()
          .slice(0, 25);
        streamOps.push(
          `BT /F1 6.2 Tf ${(labelXPt + 2 * MM_TO_PT).toFixed(2)} ${(
            22.8 * MM_TO_PT
          ).toFixed(2)} Td (${prodName}) Tj ET`
        );

        // 4. Variação: COR e TAMANHO
        const colorStr = `COR: ${sanitizeText(item.color || 'PADRAO').toUpperCase()}`;
        streamOps.push(
          `BT /F1 5.2 Tf ${(labelXPt + 2 * MM_TO_PT).toFixed(2)} ${(
            19.8 * MM_TO_PT
          ).toFixed(2)} Td (${colorStr}) Tj ET`
        );

        const tamStr = `TAM: ${sanitizeText(item.size || 'UN').toUpperCase()}`;
        const tamBoxWPt = (tamStr.length * 3.3 + 4) * (MM_TO_PT / 2.8346);
        const tamBoxXPt = labelXPt + 38 * MM_TO_PT - tamBoxWPt;
        const tamBoxYPt = 19.4 * MM_TO_PT;
        streamOps.push(
          `0.4 w 0 0 0 RG ${tamBoxXPt.toFixed(2)} ${tamBoxYPt.toFixed(2)} ${tamBoxWPt.toFixed(
            2
          )} ${(2.6 * MM_TO_PT).toFixed(2)} re S`
        );
        streamOps.push(
          `0 0 0 rg BT /F1 5.2 Tf ${(tamBoxXPt + 1.2 * MM_TO_PT).toFixed(2)} ${(
            tamBoxYPt + 0.6 * MM_TO_PT
          ).toFixed(2)} Td (${tamStr}) Tj ET`
        );

        // 5. Código de Barras Vetorial Code 128 (Subset B)
        const barcodeValue = item.barcode || '7890000000000';
        const codeRes = encodeCode128(barcodeValue, 10);

        const targetBarWidthMm = 34; // Largura total de leitura óptica
        const targetBarHeightMm = 12.5; // Altura segura para leitor CCD/Laser
        const barStartXPt = labelXPt + ((labelWidthMm - targetBarWidthMm) / 2) * MM_TO_PT;
        const barStartYPt = 4.8 * MM_TO_PT;
        const barHeightPt = targetBarHeightMm * MM_TO_PT;

        const moduleWidthPt = (targetBarWidthMm * MM_TO_PT) / codeRes.totalWidth;

        // Barras pretas vetoriais exatas (re f)
        codeRes.bars.forEach((b) => {
          const bx = barStartXPt + b.x * moduleWidthPt;
          const bw = b.width * moduleWidthPt;
          streamOps.push(
            `${bx.toFixed(2)} ${barStartYPt.toFixed(2)} ${bw.toFixed(2)} ${barHeightPt.toFixed(
              2
            )} re f`
          );
        });

        // 6. Texto legível humanizado do código de barras
        const bcText = sanitizeText(barcodeValue);
        const textApproxWidthPt = bcText.length * 4.2;
        const textXPt = labelXPt + (labelWidthMm / 2) * MM_TO_PT - textApproxWidthPt / 2;
        streamOps.push(
          `BT /F2 6 Tf ${textXPt.toFixed(2)} ${(2.0 * MM_TO_PT).toFixed(2)} Td (${bcText}) Tj ET`
        );
      });

      pages.push(streamOps.join('\n'));
    }
  });

  if (pages.length === 0) {
    // Página em branco padrão caso nenhum item seja fornecido
    pages.push('');
  }

  // ── Estrutura PDF Padrão ISO 32000-1 ──
  const objects: string[] = [];
  let currentObjId = 1;

  const catalogId = currentObjId++;
  const pagesRootId = currentObjId++;
  const font1Id = currentObjId++;
  const font2Id = currentObjId++;

  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  pages.forEach(() => {
    pageObjectIds.push(currentObjId++);
    contentObjectIds.push(currentObjId++);
  });

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`;
  objects[pagesRootId] = `<< /Type /Pages /Kids [${pageObjectIds
    .map((id) => `${id} 0 R`)
    .join(' ')}] /Count ${pages.length} >>`;
  objects[font1Id] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
  objects[font2Id] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>`;

  pages.forEach((streamContent, idx) => {
    const pId = pageObjectIds[idx];
    const cId = contentObjectIds[idx];

    objects[pId] = `<<
  /Type /Page
  /Parent ${pagesRootId} 0 R
  /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}]
  /Resources <<
    /Font <<
      /F1 ${font1Id} 0 R
      /F2 ${font2Id} 0 R
    >>
  >>
  /Contents ${cId} 0 R
>>`;

    const streamBytes = new TextEncoder().encode(streamContent);
    objects[cId] = `<< /Length ${streamBytes.length} >>\nstream\n${streamContent}\nendstream`;
  });

  let pdfText = `%PDF-1.4\n%MBGRUPO\n`;
  const xref: string[] = [];
  xref[0] = `0000000000 65535 f \n`;

  for (let i = 1; i < currentObjId; i++) {
    const offset = new TextEncoder().encode(pdfText).length;
    xref[i] = `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdfText += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = new TextEncoder().encode(pdfText).length;
  pdfText += `xref\n0 ${currentObjId}\n${xref.join('')}`;
  pdfText += `trailer\n<< /Size ${currentObjId} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdfText);
}

/**
 * Cria um objeto Blob do PDF pronto para download ou abertura no navegador
 */
export function generateLabelsPdfBlob(
  items: LabelPrintItem[],
  options?: LabelPrintOptions
): Blob {
  const bytes = generateLabelsPdf(items, options);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

/**
 * Dispara o download automático do arquivo PDF de etiquetas
 */
export function downloadLabelsPdf(
  items: LabelPrintItem[],
  filename = 'etiquetas_mb_grupo_82x30mm.pdf',
  options?: LabelPrintOptions
): void {
  const blob = generateLabelsPdfBlob(items, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Abre o PDF em nova aba para visualização e impressão direta em escala real 100%
 */
export function openLabelsPdfInNewTab(
  items: LabelPrintItem[],
  options?: LabelPrintOptions
): void {
  const blob = generateLabelsPdfBlob(items, options);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

