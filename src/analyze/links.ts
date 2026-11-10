/** MIDI コーパス取得用のユーティリティ (純粋関数・ネットワークなし) */

const MIDI_HREF = /href\s*=\s*["']([^"']+\.midi?)["']/gi;

/** HTML から .mid リンクを絶対URLで抽出する (順序維持・重複除去) */
export function extractMidiLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(MIDI_HREF)) {
    const raw = m[1]!;
    try {
      const abs = new URL(raw, pageUrl).toString();
      if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
    } catch { /* 壊れたURLは無視 */ }
  }
  return out;
}

/** URL からローカル保存名を作る (危険な文字を除去・重複対策) */
export function safeLocalName(url: string, index = 0): string {
  try {
    const decoded = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    const cleaned = decoded.replace(/[\\/:*?"<>|]/g, "_").trim();
    return cleaned.length > 0 ? cleaned : `track-${index}.mid`;
  } catch {
    return `track-${index}.mid`;
  }
}
