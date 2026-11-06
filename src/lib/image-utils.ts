/**
 * Utilitário de Processamento e Compressão de Imagens
 * Estoque Digital — MB Grupo
 *
 * Reduz automaticamente fotografias de produtos para economizar espaço
 * no armazenamento local (localStorage) e acelerar a renderização visual.
 */

export async function compressImage(
  file: File,
  maxWidth = 600,
  maxHeight = 600,
  quality = 0.75
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Se não for arquivo de imagem válido, rejeita
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('O arquivo selecionado não é uma imagem válida.'));
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calcula dimensões proporcionais preservando proporção de tela
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // Fallback para o dataUrl original se canvas não estiver disponível
          resolve(e.target?.result as string);
          return;
        }

        // Renderiza com interpolação suave
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Exporta em formato JPEG comprimido
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };

      img.onerror = () => {
        reject(new Error('Não foi possível carregar a imagem para compressão.'));
      };

      img.src = e.target?.result as string;
    };

    reader.onerror = () => {
      reject(new Error('Erro na leitura do arquivo de imagem.'));
    };

    reader.readAsDataURL(file);
  });
}

