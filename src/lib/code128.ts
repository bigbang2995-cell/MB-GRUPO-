/**
 * Gerador de Código de Barras Padrão Code 128 (Subset B)
 * Conforme norma ISO/IEC 15417
 * MB Grupo — Sistema de Gestão e Bipagem de Estoque
 */

// Tabela completa de 107 padrões de barras e espaços do Code 128 (valores 0 a 106)
// Cada dígito representa a largura em módulos (1 a 4).
// Alternam-se: Barra, Espaço, Barra, Espaço, Barra, Espaço (soma = 11 módulos, exceto Stop = 13 módulos)
export const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", // 0-9
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", // 10-19
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", // 20-29
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", // 30-39
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", // 40-49
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", // 50-59
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", // 60-69
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", // 70-79
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", // 80-89
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", // 90-99
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112" // 100-106
];

export const START_B = 104;
export const STOP = 106;

export interface Code128Bar {
  x: number;
  width: number;
}

export interface Code128Result {
  text: string;
  bars: Code128Bar[];
  totalWidth: number;
  checkValue: number;
  quietZone: number;
  svgPath: string;
}

/**
 * Codifica uma string em padrão Code 128 (Subset B).
 * Adiciona zona de silêncio (quiet zone) nas extremidades para leitura óptica por leitor USB.
 */
export function encodeCode128(text: string, quietZoneModules = 10): Code128Result {
  const safeText = text || ' ';
  let checksum = START_B;
  const patternSequence: string[] = [CODE128_PATTERNS[START_B]];

  for (let i = 0; i < safeText.length; i++) {
    const code = safeText.charCodeAt(i);
    // Subset B cobre caracteres ASCII de 32 (espaço) a 126 (~)
    const val = code >= 32 && code <= 126 ? code - 32 : 0;
    checksum += (i + 1) * val;
    patternSequence.push(CODE128_PATTERNS[val]);
  }

  const checkValue = checksum % 103;
  patternSequence.push(CODE128_PATTERNS[checkValue]);
  patternSequence.push(CODE128_PATTERNS[STOP]);

  let currentX = quietZoneModules;
  const bars: Code128Bar[] = [];
  const pathParts: string[] = [];

  for (const pattern of patternSequence) {
    for (let j = 0; j < pattern.length; j++) {
      const width = parseInt(pattern[j], 10);
      const isBar = j % 2 === 0; // Dígitos pares são barras (pretas), ímpares são espaços
      if (isBar) {
        bars.push({ x: currentX, width });
        // Path SVG otimizado: retângulo de altura normalizada 100
        pathParts.push(`M${currentX},0h${width}v100h-${width}z`);
      }
      currentX += width;
    }
  }

  const totalWidth = currentX + quietZoneModules;

  return {
    text: safeText,
    bars,
    totalWidth,
    checkValue,
    quietZone: quietZoneModules,
    svgPath: pathParts.join(''),
  };
}

