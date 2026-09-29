import { useRef, useState, type KeyboardEvent } from "react";

interface ChatInputProps {
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export default function ChatInput({ running, onSend, onStop }: ChatInputProps) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const autoResize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const submit = () => {
    const t = text.trim();
    if (!t || running) return;
    onSend(t);
    setText("");
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
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder="问我任何问题，Enter 发送，Shift + Enter 换行"
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
            disabled={!text.trim()}
            className="h-[42px] shrink-0 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 px-5 text-sm font-medium text-white shadow-lg shadow-indigo-950/40 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        )}
      </div>
      <div className="mx-auto mt-1.5 max-w-3xl text-[11px] text-slate-500">
        AI 生成内容仅供参考，重要信息请以大赛官网公告为准。
      </div>
    </div>
  );
}
