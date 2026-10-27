import { VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS, type ListingMedia } from '@hogulink/contracts';
import { api, ClientError } from './api';
import { IMAGE_UPLOAD_LIMIT } from './image-upload';

/** A Blob's contents as base64, without the data-URL prefix. */
export function blobBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Reads the duration and grabs an early frame as the cover, entirely in the browser. */
export async function videoFacts(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  // A file the browser cannot decode may never fire an event; give up instead of waiting forever.
  const step = (start: (done: () => void) => void) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ClientError('INVALID_VIDEO', 'Unreadable video')),
        15000,
      );
      video.onerror = () => {
        clearTimeout(timer);
        reject(new ClientError('INVALID_VIDEO', 'Unreadable video'));
      };
      start(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  try {
    await step((done) => {
      video.onloadedmetadata = done;
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0)
      throw new ClientError('INVALID_VIDEO', 'Unknown duration');
    await step((done) => {
      video.onseeked = done;
      video.currentTime = Math.min(0.5, duration / 2);
    });
    const canvas = document.createElement('canvas');
    let edge = 1280,
      poster: Blob | null = null;
    for (let round = 0; round < 4 && !poster; round++, edge = Math.floor(edge * 0.75)) {
      const scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
      if (blob && blob.size <= IMAGE_UPLOAD_LIMIT) poster = blob;
    }
    if (!poster) throw new ClientError('INVALID_VIDEO', 'Cover frame unavailable');
    return { duration, poster };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads in parts so each request stays small, then asks the server to check the whole file. */
export async function uploadVideo(
  file: File,
  options: { listingId?: string; consent?: boolean },
  onProgress: (fraction: number) => void,
) {
  if (file.size > VIDEO_MAX_BYTES) throw new ClientError('VIDEO_TOO_LARGE', 'Video too large');
  const facts = await videoFacts(file);
  if (facts.duration > VIDEO_MAX_SECONDS + 0.5)
    throw new ClientError('VIDEO_TOO_LONG', 'Video too long');
  const started = await api<{ uploadId: string; chunkBytes: number; chunks: number }>(
    'media/videos',
    { size: file.size, ...options },
  );
  for (let i = 0; i < started.chunks; i++) {
    const part = file.slice(i * started.chunkBytes, (i + 1) * started.chunkBytes);
    await api(`media/videos/${started.uploadId}/chunks`, {
      index: i,
      data: await blobBase64(part),
    });
    onProgress((i + 1) / (started.chunks + 1));
  }
  const result = await api<ListingMedia>(`media/videos/${started.uploadId}/finish`, {
    durationSeconds: Math.round(facts.duration * 10) / 10,
    poster: { mime: 'image/jpeg', data: await blobBase64(facts.poster) },
  });
  onProgress(1);
  return result;
}
