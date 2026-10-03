/**
 * 图片上传前的归一化处理：
 * 1. 移动端照片普遍 5-12MB，远超接口体积限制，先在本地压缩（长边 ≤1600px、JPEG 质量 0.85）；
 * 2. iPhone 相册照片为 HEIC 格式，浏览器 <img> 与视觉模型都不支持，统一转码为 JPEG；
 * 3. 解码失败（个别老机型/特殊格式）时回退原始 dataURL，由后续链路兜底报错。
 */

export const MAX_IMAGE_SIDE = 1600;
export const JPEG_QUALITY = 0.85;

/**
 * 读取文件为 data URL。失败时把 FileReader 的错误原样抛出，
 * 由调用方统一转成"这张图读取失败，请换一张"的用户提示。
 */
export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 解码图片。
 * 解码失败通常意味着浏览器不支持该格式（例如未转码的 HEIC），
 * 调用方会捕获并回退到原始 data URL，让后续链路给出可解释的报错。
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

/**
 * 把任意图片文件归一化为可直接上传/预览的 data URL（优先压缩为 JPEG）。
 *
 * 处理顺序与原因：
 * 1. 先读成 data URL —— 无论后续是否压缩，预览都需要它；
 * 2. 长边超过 MAX_IMAGE_SIDE 时等比缩放 —— 手机原图 4000px+ 既占带宽也拖慢视觉模型；
 * 3. 统一导出 JPEG —— 顺带解决 iPhone HEIC 无法被 <img> 与视觉模型识别的问题；
 * 4. 仅当压缩结果确实更小才采用，避免小图被"压缩"反而变大。
 */
export async function normalizeImage(file: File): Promise<string> {
  const raw = await readAsDataURL(file);
  try {
    const img = await loadImage(raw);
    const side = Math.max(img.naturalWidth, img.naturalHeight);
    // 只缩小不放大：小图保持原尺寸，避免拉伸后变糊
    const scale = Math.min(1, MAX_IMAGE_SIDE / side);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // 极端环境（如部分无 GPU 的嵌入式浏览器）拿不到 2D 上下文时，退回原图而不是报错
    if (!ctx) return raw;
    // 白底填充：PNG 透明区域转 JPEG 后会变黑，先铺白再绘制更接近用户预期
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return out.length > 0 && out.length < raw.length ? out : raw;
  } catch {
    return raw;
  }
}
