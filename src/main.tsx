/**
 * 应用入口：把 <App /> 挂到 index.html 的 #root 上。
 *
 * 说明：这里保留 React.StrictMode。它在开发态会刻意双调用 effect 与渲染函数，
 * 用于暴露副作用清理问题；本应用的副作用都是幂等或自带清理的
 * （SSE 连接在卸载/停止时会 abort，语音识别在卸载时会 abort），
 * 因此不需要为了"图省事"去掉 StrictMode。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  // index.html 与入口是配套的；缺失说明构建产物被替换过，尽早抛出比静默白屏更好排查
  throw new Error("未找到挂载节点 #root，请检查 index.html 是否完整");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
