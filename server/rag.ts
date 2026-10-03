import fs from "node:fs";
import path from "node:path";
import type { KbSource } from "../shared/protocol";
import { loadProjectEnv } from "./env";

/**
 * 混合检索层（RAG）——支持多知识域：
 * 1. 每个知识域一个 JSON 文件，域内独立构建 BM25 统计量（避免跨域稀释 IDF）；
 * 2. 可插拔向量检索适配器：配置 EMBEDDING_API_KEY（或智谱 Key）后自动启用，
 *    余弦相似度 + BM25 加权融合；初始化或调用失败自动降级 BM25，检索层永不抛错；
 * 3. 检索可限定 domain，也可跨域检索（domain = "all"）。
 *
 * 多知识域是本作品「场景可迁移」的工程证据：同一套 Agent（规划 → 检索 → 工具 → 引用）
 * 只要挂载不同语料，即可服务赛事备赛、校园学习等不同场景。
 */

export interface KbChunk {
  id: string;
  title: string;
  category: string;
  text: string;
  /** 所属知识域 id */
  domain: string;
}

export interface RetrievalResult {
  chunk: KbChunk;
  /** 归一化到 [0,1] 的展示分（最高分为 1.0，仅用于排序与可视化） */
  score: number;
  /** 归一化之前的原始融合分 / BM25 分，用于如实展示"相关度"而不是恒定的 1.00 */
  rawScore: number;
}

export interface DomainInfo {
  id: string;
  name: string;
  description: string;
  chunks: number;
}

interface DomainDef {
  id: string;
  name: string;
  description: string;
  file: string;
}

/** 知识域清单：新增场景只需在这里登记 + 放一个 JSON 语料文件 */
const DOMAIN_DEFS: DomainDef[] = [
  {
    id: "competition",
    name: "赛事备赛",
    description: "传智杯等赛事规则、评审标准、提交要求与奖项设置",
    file: "knowledge.json",
  },
  {
    id: "campus",
    name: "校园学习",
    description: "选课学分、绩点保研、四六级、考研时间线、实习就业、学术规范等校园常见问题",
    file: "knowledge-campus.json",
  },
];

const DATA_DIR = path.resolve(process.cwd(), "data");

function loadDomain(def: DomainDef): KbChunk[] {
  const file = path.join(DATA_DIR, def.file);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { chunks?: Array<Omit<KbChunk, "domain">> };
  const list = Array.isArray(parsed.chunks) ? parsed.chunks : [];
  return list.map((c) => ({ ...c, domain: def.id }));
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

// ---------- BM25（按域独立构建） ----------

const K1 = 1.5;
const B = 0.75;

interface DomainIndex {
  def: DomainDef;
  chunks: KbChunk[];
  docTerms: string[][];
  docTf: Array<Map<string, number>>;
  avgLen: number;
  idf: Map<string, number>;
}

function buildIndex(def: DomainDef, chunks: KbChunk[]): DomainIndex {
  // 字段加权：标题重复 4 次、分类重复 2 次参与索引，让标题命中显著优先于正文偶然命中
  const docTerms = chunks.map((c) =>
    tokenize(`${c.title} ${c.title} ${c.title} ${c.title} ${c.category} ${c.category} ${c.text}`),
  );
  const docTf = docTerms.map((terms) => {
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const total = docTerms.reduce((s, t) => s + t.length, 0);
  const avgLen = total / Math.max(1, docTerms.length);
  const df = new Map<string, number>();
  for (const terms of docTerms) {
    for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, docTerms.length);
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log((N - count + 0.5) / (count + 0.5) + 1));
  return { def, chunks, docTerms, docTf, avgLen, idf };
}

const indexes: DomainIndex[] = DOMAIN_DEFS.map((def) => buildIndex(def, loadDomain(def))).filter(
  (idx) => idx.chunks.length > 0,
);
const ALL_CHUNKS: KbChunk[] = indexes.flatMap((idx) => idx.chunks);

/** 可用知识域（供 /api/health 与界面选择器使用） */
export function domains(): DomainInfo[] {
  return indexes.map((idx) => ({
    id: idx.def.id,
    name: idx.def.name,
    description: idx.def.description,
    chunks: idx.chunks.length,
  }));
}

/** 全部知识库规模 */
export function knowledgeSize(): number {
  return ALL_CHUNKS.length;
}

/** 当前检索模式（供 /api/health 与日志展示） */
export function retrievalMode(): "bm25" | "bm25+vector" {
  return getEmbedder() ? "bm25+vector" : "bm25";
}

function bm25Score(query: string, domainIdx: DomainIndex, docIdx: number): number {
  const tfMap = domainIdx.docTf[docIdx];
  const docLen = domainIdx.docTerms[docIdx].length;
  let score = 0;
  for (const term of new Set(tokenize(query))) {
    const tf = tfMap.get(term);
    if (!tf) continue;
    const idfValue = domainIdx.idf.get(term) ?? 0;
    const denom = tf + K1 * (1 - B + B * (docLen / (domainIdx.avgLen || 1)));
    score += idfValue * ((tf * (K1 + 1)) / denom);
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
  const provider = (process.env.AI_PROVIDER ?? env.AI_PROVIDER ?? "").toLowerCase();
  const key =
    process.env.EMBEDDING_API_KEY ??
    env.EMBEDDING_API_KEY ??
    (provider === "zhipu" ? (process.env.AI_API_KEY ?? env.AI_API_KEY ?? "") : "");
  if (!key) return null;
  const model = process.env.EMBEDDING_MODEL ?? env.EMBEDDING_MODEL ?? "embedding-3";
  const baseUrl = process.env.EMBEDDING_BASE_URL ?? env.EMBEDDING_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
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

// 向量索引懒加载：按域构建并常驻内存
interface VectorState {
  ready: boolean;
  chunkVecs: number[][];
  embedder: Embedder | null;
}
const vectorStates = new Map<string, VectorState>();
const vectorInitPromises = new Map<string, Promise<VectorState>>();

function ensureVectorIndex(domainId: string, domainIdx: DomainIndex): Promise<VectorState> {
  const cached = vectorStates.get(domainId);
  if (cached) return Promise.resolve(cached);
  const pending = vectorInitPromises.get(domainId);
  if (pending) return pending;
  const promise = (async () => {
    const embedder = getEmbedder();
    if (!embedder) {
      const state: VectorState = { ready: false, chunkVecs: [], embedder: null };
      vectorStates.set(domainId, state);
      return state;
    }
    try {
      const texts = domainIdx.chunks.map((c) => `${c.title}\n${c.category}\n${c.text}`);
      const chunkVecs = await embedder.embed(texts);
      const state: VectorState = { ready: true, chunkVecs, embedder };
      vectorStates.set(domainId, state);
      return state;
    } catch {
      // 向量索引构建失败：静默降级 BM25
      const state: VectorState = { ready: false, chunkVecs: [], embedder: null };
      vectorStates.set(domainId, state);
      return state;
    }
  })();
  vectorInitPromises.set(domainId, promise);
  return promise;
}

// ---------- 融合检索 ----------

function maxNormalize(list: Array<{ chunk: KbChunk; score: number }>): Map<string, number> {
  const max = Math.max(...list.map((r) => r.score), 1e-9);
  return new Map(list.map((r) => [r.chunk.id, Math.max(r.score, 0) / max]));
}

export interface RetrieveOptions {
  /** 限定知识域；"all" 或省略表示跨域检索 */
  domain?: string;
}

/** 混合检索：BM25 始终参与；向量可用时按 0.45/0.55 加权融合。返回分数统一归一化到 [0,1] */
export async function retrieve(query: string, topK = 3, options: RetrieveOptions = {}): Promise<RetrievalResult[]> {
  const requested = options.domain && options.domain !== "all" ? options.domain : undefined;
  const active = requested ? indexes.filter((idx) => idx.def.id === requested) : indexes;
  const usable = active.length > 0 ? active : indexes;

  const scoredLists = await Promise.all(
    usable.map(async (domainIdx) => {
      const bm25List = domainIdx.chunks.map((chunk, i) => ({ chunk, score: bm25Score(query, domainIdx, i) }));
      const vs = await ensureVectorIndex(domainIdx.def.id, domainIdx);
      if (!vs.ready || !vs.embedder) return bm25List;
      try {
        const [queryVec] = await vs.embedder.embed([query]);
        const vecList = domainIdx.chunks.map((chunk, i) => ({
          chunk,
          score: cosine(queryVec, vs.chunkVecs[i]),
        }));
        const nb = maxNormalize(bm25List);
        const nv = maxNormalize(vecList);
        return domainIdx.chunks.map((chunk) => ({
          chunk,
          score: 0.45 * (nb.get(chunk.id) ?? 0) + 0.55 * (nv.get(chunk.id) ?? 0),
        }));
      } catch {
        return bm25List; // 查询向量失败：降级 BM25
      }
    }),
  );

  const scored = scoredLists.flat().sort((a, b) => b.score - a.score);
  const rawById = new Map(scored.map((r) => [r.chunk.id, r.score]));
  const nb = maxNormalize(scored);
  return scored
    .map((r) => ({
      chunk: r.chunk,
      score: nb.get(r.chunk.id) ?? 0,
      rawScore: rawById.get(r.chunk.id) ?? 0,
    }))
    .filter((r) => r.score > 0)
    .slice(0, topK);
}

/**
 * 相关性判断：最高分文档对查询词项的覆盖率是否达标。
 * 相比绝对分数阈值，词项覆盖率与语料规模无关，语义直观且易解释。
 */
export function isRelevant(query: string, results: RetrievalResult[], minCoverage = 0.2): boolean {
  if (results.length === 0 || results[0].score <= 0) return false;
  return termCoverage(query, results[0].chunk.title, results[0].chunk.text) >= minCoverage;
}

/** 查询词项在文档中的覆盖率（[0,1]），与语料规模无关，可解释性强 */
export function termCoverage(query: string, title: string, text: string): number {
  const qTerms = new Set(tokenize(query));
  if (qTerms.size === 0) return 0;
  const docTerms = new Set(tokenize(`${title} ${text}`));
  let hit = 0;
  for (const t of qTerms) if (docTerms.has(t)) hit++;
  return hit / qTerms.size;
}

/**
 * 检索质量的可读标签。避免此前"最高相关度恒为 1.00"的失真展示：
 * 用词项覆盖率 + 命中条数共同描述，评委/用户都能看懂。
 */
export function relevanceLabel(query: string, results: RetrievalResult[]): string {
  if (results.length === 0) return "无召回";
  const top = results[0];
  const coverage = Math.round(termCoverage(query, top.chunk.title, top.chunk.text) * 100);
  const domainName = indexes.find((idx) => idx.def.id === top.chunk.domain)?.def.name ?? top.chunk.domain;
  return `[${domainName}] 召回 ${results.length} 条，最高词项覆盖率 ${coverage}%`;
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
