import fs from "node:fs";
import path from "node:path";
import type { KbSource } from "../shared/protocol";

/**
 * 轻量 RAG 实现：TF-IDF 向量检索（中文按字符 unigram + bigram 分词）。
 * 初版不引入外部向量库，检索策略集中在此处，便于后续替换为向量检索（如 pgvector / Milvus）。
 */

export interface KbChunk {
  id: string;
  title: string;
  category: string;
  text: string;
}

interface IndexedChunk extends KbChunk {
  vector: Map<string, number>;
  norm: number;
}

interface KbFile {
  name: string;
  version: string;
  description: string;
  chunks: KbChunk[];
}

export function loadKnowledgeBase(): KbFile {
  const file = path.resolve(process.cwd(), "data", "knowledge.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as KbFile;
}

/** 中文分词：字符 unigram + bigram，英文按单词 */
function tokenize(text: string): string[] {
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

function buildVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const vector = new Map<string, number>();
  for (const [term, count] of tf) {
    const w = (count / tokens.length) * (idf.get(term) ?? Math.log(1 + 50));
    vector.set(term, w);
  }
  return vector;
}

function vecNorm(v: Map<string, number>): number {
  let s = 0;
  for (const w of v.values()) s += w * w;
  return Math.sqrt(s);
}

function buildIndex(chunks: KbChunk[]): { index: IndexedChunk[]; idf: Map<string, number> } {
  // 计算 IDF
  const df = new Map<string, number>();
  for (const c of chunks) {
    const seen = new Set(tokenize(`${c.title} ${c.text}`));
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = chunks.length;
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 0.5)));
  }
  const index: IndexedChunk[] = chunks.map((c) => {
    const vector = buildVector(tokenize(`${c.title} ${c.title} ${c.text}`), idf);
    return { ...c, vector, norm: vecNorm(vector) };
  });
  return { index, idf };
}

const kb = loadKnowledgeBase();
const { index, idf } = buildIndex(kb.chunks);

export interface RetrievalResult {
  chunk: KbChunk;
  score: number;
}

/** 检索：返回与查询最相关的 topK 个知识片段 */
export function retrieve(query: string, topK = 3): RetrievalResult[] {
  const qv = buildVector(tokenize(query), idf);
  const qNorm = vecNorm(qv);
  if (qNorm === 0) return [];
  const scored = index.map((c) => {
    let dot = 0;
    for (const [term, w] of qv) {
      const cw = c.vector.get(term);
      if (cw) dot += w * cw;
    }
    return { chunk: c as KbChunk, score: dot / (qNorm * c.norm || 1) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
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
