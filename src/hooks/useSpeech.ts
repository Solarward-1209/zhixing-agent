import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 语音交互（Web Speech API）：
 * - useSpeechInput：浏览器端语音转文字，用于输入框；不支持时优雅降级（按钮隐藏/禁用）
 * - useSpeechOutput：朗读回答（TTS），用于无障碍与"听答案"场景
 *
 * 全部为浏览器原生能力，无第三方依赖；Chrome / Edge 支持最佳。
 */

interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternativeLike;
}
interface SpeechResultListLike {
  length: number;
  [index: number]: SpeechResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechResultListLike;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechInputHandlers {
  /** 识别到最终文本时回调（可直接追加到输入框） */
  onFinal: (text: string) => void;
}

/**
 * 语音输入 Hook。
 *
 * 设计取舍：
 * - 用 continuous + interimResults：允许边说边改、说停才落库，体验接近系统输入法；
 * - 最终文本通过回调交给调用方，Hook 自己不持有输入内容，避免与输入框形成"双份状态"；
 * - 卸载时 abort 识别，防止离开页面后麦克风仍在占用（隐私与电量）。
 */
export function useSpeechInput({ onFinal }: SpeechInputHandlers) {
  const [supported] = useState(() => getSpeechRecognition() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("当前浏览器不支持语音识别，建议使用 Chrome / Edge");
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        setListening(true);
        setError("");
      };
      // 识别结果分"最终"与"临时"：最终结果立即上屏，临时结果只用于回显，避免反复改写输入框
      recognition.onresult = (event) => {
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) finalRef.current(text.trim());
          else interimText += text;
        }
        setInterim(interimText);
      };
      // 把浏览器错误码翻译成人能看懂的话术；not-allowed 是最常见的一种，单独提示更可行动
      recognition.onerror = (event) => {
        setError(event.error === "not-allowed" ? "麦克风权限被拒绝" : `语音识别出错：${event.error ?? "未知"}`);
        setListening(false);
      };
      recognition.onend = () => {
        setListening(false);
        setInterim("");
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : "语音识别启动失败");
      setListening(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, interim, error, start, stop, toggle };
}

/**
 * 回答朗读 Hook（TTS）。
 *
 * 关键处理：先剥离 Markdown 记号与代码块再朗读——
 * 否则屏幕阅读式的语音会把 **、[]()、代码符号逐字读出来，反而更难听懂。
 * 同时截断到 2000 字，避免超长回答一次性塞进合成引擎导致卡顿或超时。
 */
export function useSpeechOutput() {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      // 去掉 Markdown 记号与代码块，避免朗读出无意义符号
      const plain = text
        .replace(/```[\s\S]*?```/g, "（代码块已省略）")
        .replace(/[*_>`#~|-]/g, " ")
        .replace(/\[(\d+)\]/g, "引用$1")
        .replace(/\s+/g, " ")
        .trim();
      if (!plain) return;
      const utterance = new SpeechSynthesisUtterance(plain.slice(0, 2000));
      utterance.lang = "zh-CN";
      utterance.rate = 1.05;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  return { supported, speaking, speak, stop };
}
