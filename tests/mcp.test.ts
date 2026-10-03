import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getMcpServers, listMcpTools, mcpToolName, parseMcpToolName } from "../server/mcp";
import { executeTool, listToolSchemas, toolSchemas } from "../server/tools";

/**
 * MCP 客户端测试。
 *
 * 刻意**不 mock 掉函数**，而是起一个真实的本地 HTTP 服务实现 JSON-RPC 握手：
 * 因为 MCP 的风险恰恰在协议细节（会话头、notification 的 202、SSE 响应体），
 * mock 掉这些等于把最该验证的部分绕过去了。
 * 除主链路外，还覆盖未配置、非法配置、服务不可达三类降级——
 * 它们决定了 MCP 出问题时会不会连累主问答流程。
 */
let server: http.Server;
let url = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      // notification：MCP 规范允许返回 202 无体
      if (body.id === undefined) {
        res.writeHead(202, { "Mcp-Session-Id": "test-session" });
        res.end();
        return;
      }
      const reply = (result: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "test-session" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      };
      if (body.method === "initialize") {
        reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0.1" } });
      } else if (body.method === "tools/list") {
        reply({
          tools: [
            {
              name: "echo",
              description: "回显输入的文本",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string", description: "要回显的文本" } },
                required: ["text"],
              },
            },
          ],
        });
      } else if (body.method === "tools/call") {
        const args = (body.params?.arguments ?? {}) as { text?: string };
        reply({ content: [{ type: "text", text: `echo: ${args.text ?? ""}` }] });
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  url = `http://127.0.0.1:${port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => vi.unstubAllEnvs());

describe("MCP 配置解析", () => {
  it("未配置时返回空列表", () => {
    vi.stubEnv("MCP_SERVERS", "");
    vi.stubEnv("MCP_SERVER_URL", "");
    expect(getMcpServers()).toEqual([]);
  });

  it("解析 MCP_SERVERS JSON 与单个 URL 简写", () => {
    vi.stubEnv("MCP_SERVERS", JSON.stringify([{ name: "fake", url, headers: { "X-Test": "1" } }]));
    vi.stubEnv("MCP_SERVER_URL", "");
    const servers = getMcpServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("fake");
    expect(servers[0].headers?.["X-Test"]).toBe("1");
  });

  it("非法 JSON 不抛异常，按未配置处理", () => {
    vi.stubEnv("MCP_SERVERS", "{not json");
    vi.stubEnv("MCP_SERVER_URL", "");
    expect(getMcpServers()).toEqual([]);
  });

  it("工具名可安全往返转换", () => {
    const name = mcpToolName("my server", "read/file");
    expect(name).toMatch(/^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/);
    const parsed = parseMcpToolName(name);
    expect(parsed).not.toBeNull();
    expect(parsed?.server).toBe("my_server");
    expect(parseMcpToolName("calculate")).toBeNull();
  });
});

describe("MCP 工具动态发现与调用", () => {
  it("未配置 MCP 时 listToolSchemas 退化为内置工具", async () => {
    vi.stubEnv("MCP_SERVERS", "");
    vi.stubEnv("MCP_SERVER_URL", "");
    const list = await listToolSchemas();
    expect(list.map((t) => t.function.name)).toEqual(toolSchemas().map((t) => t.function.name));
  });

  it("发现远端工具并转换为 Function Calling Schema", async () => {
    vi.stubEnv("MCP_SERVERS", JSON.stringify([{ name: "fake", url }]));
    const refs = await listMcpTools();
    expect(refs).toHaveLength(1);
    const list = await listToolSchemas();
    const mcpSchema = list.find((t) => t.function.name.startsWith("mcp__fake__"));
    expect(mcpSchema).toBeTruthy();
    expect(mcpSchema?.function.description).toContain("[MCP · fake]");
    expect(mcpSchema?.function.parameters.properties.text.type).toBe("string");
    expect(mcpSchema?.function.parameters.required).toEqual(["text"]);
  });

  it("通过统一 executeTool 调用 MCP 工具并返回文本结果", async () => {
    vi.stubEnv("MCP_SERVERS", JSON.stringify([{ name: "fake", url }]));
    const result = await executeTool("mcp__fake__echo", { text: "你好 MCP" });
    expect(result.summary).toBe("echo: 你好 MCP");
    expect(result.data?.source).toBe("mcp");
    expect(result.data?.isError).toBe(false);
  });

  it("MCP Server 不可达时返回错误摘要而不是抛异常", async () => {
    vi.stubEnv("MCP_SERVERS", JSON.stringify([{ name: "dead", url: "http://127.0.0.1:9/mcp" }]));
    const result = await executeTool("mcp__dead__echo", { text: "x" });
    expect(result.data?.isError).toBe(true);
    expect(result.summary).toContain("MCP");
  }, 30000);
});
