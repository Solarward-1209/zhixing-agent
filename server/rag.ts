import fs from "node:fs";
import path from "node:path";
import type { KbSource } from "../shared/protocol";
import { loadProjectEnv } from "./env";

/**
 * 混合检索层（RAG）：
 * 1. BM25 相关性打分（本地 always-on，中文 unigram+bigram 分词）
 * 2. 可插拔向量检索适配器：配置 EMBEDDING_API_KEY（或智谱 Key）后自动启用，
 *    余弦相似度 + BM25 加权融合；初始化或调用失败自动降级 BM25，检索层永不抛错
 * 知识库：data/knowledge.json，替换为向量库（pgvector/Milvus）时仅需替换本文件
 */

export interface KbChunk {
  id: string;
  title: string;
  category: string;
  text: string;
}

export interface RetrievalResult {
  chunk: KbChunk;
  score: number;
}

function loadKnowledgeBase(): KbChunk[] {
  const file = path.resolve(process.cwd(), "data", "knowledge.json");
  const kb = JSON.parse(fs.readFileSync(file, "utf8")) as { chunks: KbChunk[] };
  return kb.chunks;
}

/** 中文分词：字符 unigram + bigram，英文按单词 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const latin = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  tokens.push(...latin);
  const chars = text.replace(/\s+/g, "");
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/[\u4e00-\u9fa5]/.test(ch)) {
      tokens.push(ch);
      if (i + 1 < chars.length && /[\u4e00-\u9fa5]/.test(chars[i + 1])) {
        tokens.push(ch + chars[i + 1]);
      }
    }
  }
  return tokens;
}

// ---------- BM25 ----------

const K1 = 1.5;
const B = 0.75;

const chunks = loadKnowledgeBase();
const N = chunks.length;

// 字段加权：标题重复 4 次、分类重复 2 次参与索引，让标题命中显著优先于正文偶然命中
const docTerms: string[][] = chunks.map((c) =>
  tokenize(`${c.title} ${c.title} ${c.title} ${c.title} ${c.category} ${c.category} ${c.text}`),
);
const docTf: Array<Map<string, number>> = docTerms.map((terms) => {
  const tf = new Map<string, number>();
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
});
const avgLen = docTerms.reduce((s, t) => s + t.length, 0) / N;

const df = new Map<string, number>();
for (const terms of docTerms) {
  for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);
}
const idf = new Map<string, number>();
for (const [term, count] of df) {
  idf.set(term, Math.log((N - count + 0.5) / (count + 0.5) + 1));
}

function bm25Score(query: string, docIdx: number): number {
  const tfMap = docTf[docIdx];
  const docLen = docTerms[docIdx].length;
  let score = 0;
  for (const term of new Set(tokenize(query))) {
    const tf = tfMap.get(term);
    if (!tf) continue;
    const idfValue = idf.get(term) ?? 0;
    score += idfValue * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / avgLen))));
  }
  return score;
}

// ---------- 向量检索适配器 ----------

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export function getEmbedder(): Embedder | null {
  const env = loadProjectEnv();
  const provider = (env.AI_PROVIDER ?? process.env.AI_PROVIDER ?? "").toLowerCase();
  const key =
    env.EMBEDDING_API_KEY ??
    process.env.EMBEDDING_API_KEY ??
    (provider === "zhipu" ? env.AI_API_KEY ?? process.env.AI_API_KEY ?? "" : "");
  if (!key) return null;
  const model = env.EMBEDDING_MODEL ?? process.env.EMBEDDING_MODEL ?? "embedding-3";
  const baseUrl = env.EMBEDDING_BASE_URL ?? process.env.EMBEDDING_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
  return {
    name: `${model}`,
    async embed(texts) {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`Embedding 请求失败：HTTP ${res.status}`);
      const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      const vecs = data.data?.map((d) => d.embedding);
      if (!vecs || vecs.length !== texts.length) throw new Error("Embedding 响应数量不一致");
      return vecs;
    },
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** 当前检索模式（供 /api/health 与日志展示） */
export function retrievalMode(): "bm25" | "bm25+vector" {
  return getEmbedder() ? "bm25+vector" : "bm25";
}

// 向量索引懒加载：首次检索时构建并常驻内存
interface VectorState {
  ready: boolean;
  chunkVecs: number[][];
  embedder: Embedder | null;
}
let vectorState: VectorState | null = null;
let vectorInitPromise: Promise<VectorState> | null = null;

function ensureVectorIndex(): Promise<VectorState> {
  if (vectorState) return Promise.resolve(vectorState);
  if (vectorInitPromise) return vectorInitPromise;
  vectorInitPromise = (async () => {
    const embedder = getEmbedder();
    if (!embedder) {
      vectorState = { ready: false, chunkVecs: [], embedder: null };
      return vectorState;
    }
    try {
      const texts = chunks.map((c) => `${c.title}\n${c.category}\n${c.text}`);
      const chunkVecs = await embedder.embed(texts);
      vectorState = { ready: true, chunkVecs, embedder };
    } catch {
      // 向量索引构建失败：静默降级 BM25
      vectorState = { ready: false, chunkVecs: [], embedder: null };
    }
    return vectorState;
  })();
  return vectorInitPromise;
}

// ---------- 融合检索 ----------

function maxNormalize(list: Array<{ chunk: KbChunk; score: number }>): Map<string, number> {
  const max = Math.max(...list.map((r) => r.score), 1e-9);
  return new Map(list.map((r) => [r.chunk.id, Math.max(r.score, 0) / max]));
}

/** 混合检索：BM25 始终参与；向量可用时按 0.45/0.55 加权融合。返回分数统一归一化到 [0,1] */
export async function retrieve(query: string, topK = 3): Promise<RetrievalResult[]> {
  const bm25List = chunks.map((chunk, i) => ({ chunk, score: bm25Score(query, i) }));

  const vs = await ensureVectorIndex();
  let scored: Array<{ chunk: KbChunk; score: number }>;

  if (vs.ready && vs.embedder) {
    try {
      const [queryVec] = await vs.embedder.embed([query]);
      const vecList = chunks.map((chunk, i) => ({ chunk, score: cosine(queryVec, vs.chunkVecs[i]) }));
      const nb = maxNormalize(bm25List);
      const nv = maxNormalize(vecList);
      scored = chunks.map((chunk) => ({
        chunk,
        score: 0.45 * (nb.get(chunk.id) ?? 0) + 0.55 * (nv.get(chunk.id) ?? 0),
      }));
    } catch {
      scored = bm25List; // 查询向量失败：降级 BM25
    }
  } else {
    scored = bm25List;
  }

  scored.sort((a, b) => b.score - a.score);
  // 统一归一化到 [0,1]：最高分为 1.0，保证不同模式下分数语义一致
  const nb = maxNormalize(scored);
  return scored
    .map((r) => ({ chunk: r.chunk, score: nb.get(r.chunk.id) ?? 0 }))
    .filter((r) => r.score > 0)
    .slice(0, topK);
}

/**
 * 相关性判断：最高分文档对查询词项的覆盖率是否达标。
 * 相比绝对分数阈值，词项覆盖率与语料规模无关，语义直观且易解释。
 */
export function isRelevant(query: string, results: RetrievalResult[], minCoverage = 0.2): boolean {
  if (results.length === 0 || results[0].score <= 0) return false;
  const qTerms = new Set(tokenize(query));
  if (qTerms.size === 0) return false;
  const docTerms = new Set(tokenize(`${results[0].chunk.title} ${results[0].chunk.text}`));
  let hit = 0;
  for (const t of qTerms) if (docTerms.has(t)) hit++;
  return hit / qTerms.size >= minCoverage;
}

/** 把检索结果整理成前端可展示的来源列表 */
export function toSources(results: RetrievalResult[]): KbSource[] {
  return results.map((r) => ({
    id: r.chunk.id,
    title: r.chunk.title,
    snippet: r.chunk.text.slice(0, 80) + (r.chunk.text.length > 80 ? "…" : ""),
  }));
}

/** 供 System Prompt 使用的知识上下文（带编号，便于模型引用 [1][2]） */
export function buildKbContext(results: RetrievalResult[]): string {
  if (results.length === 0) return "";
  return results
    .map((r, i) => `[${i + 1}]《${r.chunk.title}》（${r.chunk.category}）${r.chunk.text}`)
    .join("\n\n");
}
