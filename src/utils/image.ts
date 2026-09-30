/**
 * 图片上传前的归一化处理：
 * 1. 移动端照片普遍 5-12MB，远超接口体积限制，先在本地压缩（长边 ≤1600px、JPEG 质量 0.85）；
 * 2. iPhone 相册照片为 HEIC 格式，浏览器 <img> 与视觉模型都不支持，统一转码为 JPEG；
 * 3. 解码失败（个别老机型/特殊格式）时回退原始 dataURL，由后续链路兜底报错。
 */

export const MAX_IMAGE_SIDE = 1600;
export const JPEG_QUALITY = 0.85;

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

/** 把任意图片文件归一化为可直接上传/预览的 data URL（优先压缩为 JPEG） */
export async function normalizeImage(file: File): Promise<string> {
  const raw = await readAsDataURL(file);
  try {
    const img = await loadImage(raw);
    const side = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.min(1, MAX_IMAGE_SIDE / side);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return out.length > 0 && out.length < raw.length ? out : raw;
  } catch {
    return raw;
  }
}
