/** Upload limit shared by evidence, portraits and venue photos (bytes). */
export const IMAGE_UPLOAD_LIMIT = 350000;

/** Scales a photo down to JPEG until it fits the upload limit; small files pass through. */
export async function compressImage(file: File): Promise<File> {
  if (file.size <= IMAGE_UPLOAD_LIMIT) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    let edge = 1600,
      result: Blob | undefined;
    for (let round = 0; round < 4 && !result; round++, edge = Math.floor(edge * 0.75)) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing unavailable');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.82),
      );
      if (blob && blob.size <= IMAGE_UPLOAD_LIMIT) result = blob;
    }
    if (!result) throw new Error('Image remains too large');
    return new File([result], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } finally {
    bitmap.close();
  }
}

/** The file's contents as base64, without the data-URL prefix. */
export function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
