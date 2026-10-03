import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import type { ServerResponse } from "node:http";
import { handleAgentRequest, handleHealthRequest } from "./server/api";

/**
 * Agent API 插件：在 Vite 开发服务器上挂载 /api/chat(SSE) 与 /api/health。
 * 生产部署时可替换为独立的 Node 服务或 Next.js Route Handler（见 README）。
 */
function agentApiPlugin(): Plugin {
  return {
    name: "agent-api",
    configureServer(server) {
      server.middlewares.use("/api/chat", (req: Connect.IncomingMessage, res: ServerResponse) =>
        handleAgentRequest(req, res),
      );
      server.middlewares.use("/api/health", (_req: Connect.IncomingMessage, res: ServerResponse) =>
        handleHealthRequest(res),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), agentApiPlugin()],
  build: {
    target: "es2020",
    cssCodeSplit: true,
    // 首屏性能：把体积最大且低频变化的两块依赖拆成独立 chunk，利于浏览器长期缓存
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
});
