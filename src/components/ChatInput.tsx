import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

interface ChatInputProps {
  running: boolean;
  onSend: (text: string, images?: string[]) => void;
  onStop: () => void;
}

const MAX_IMAGES = 2;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export default function ChatInput({ running, onSend, onStop }: ChatInputProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const autoResize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const pickImages = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setNotice("");
    for (const f of files) {
      if (images.length >= MAX_IMAGES) {
        setNotice(`一次最多发送 ${MAX_IMAGES} 张图片`);
        break;
      }
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_FILE_BYTES) {
        setNotice(`「${f.name}」超过 4MB，已跳过`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, dataUrl]));
      };
      reader.readAsDataURL(f);
    }
  };

  const submit = () => {
    const t = text.trim();
    if ((!t && images.length === 0) || running) return;
    onSend(t, images.length > 0 ? images : undefined);
    setText("");
    setImages([]);
    setNotice("");
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) el.style.height = "auto";
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-slate-800 bg-slate-900/70 px-4 py-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {images.map((src, i) => (
              <div key={i} className="group relative">
                <img src={src} alt={`待发送图片 ${i + 1}`} className="h-16 w-16 rounded-lg border border-slate-700 object-cover" />
                <button
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-200 transition-colors hover:bg-red-500"
                  aria-label="移除图片"
                >
                  ✕
                </button>
              </div>
            ))}
            {notice && <span className="text-xs text-amber-300">{notice}</span>}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pickImages} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={running}
            title="发送图片（需配置视觉模型）"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-slate-700 text-lg text-slate-300 transition-colors hover:border-indigo-400 hover:text-indigo-200 disabled:opacity-40"
          >
            📷
          </button>
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            placeholder="问我任何问题，可附图片；Enter 发送，Shift + Enter 换行"
            className="max-h-40 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-[15px] leading-6 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            onChange={(e) => {
              setText(e.target.value);
              autoResize();
            }}
            onKeyDown={onKeyDown}
          />
          {running ? (
            <button
              onClick={onStop}
              className="h-[42px] shrink-0 rounded-xl border border-red-500/50 bg-red-500/10 px-4 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20"
            >
              ■ 停止
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() && images.length === 0}
              className="h-[42px] shrink-0 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 px-5 text-sm font-medium text-white shadow-lg shadow-indigo-950/40 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
      <div className="mx-auto mt-1.5 max-w-3xl text-[11px] text-slate-500">
        AI 生成内容仅供参考，重要信息请以大赛官网公告为准。
      </div>
    </div>
  );
}
