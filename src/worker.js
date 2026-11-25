const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200) => Response.json(obj, { status, headers: CORS });

const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const SYSTEM = `あなたはExcelの行データからカレンダー予定を抽出するアシスタントです。
入力は表の先頭行(見出し)と複数の行です。予定として登録すべき行だけを判断し、次のJSONのみを出力してください。説明文は禁止。
{"events":[{"row":0,"title":"","date":"YYYY-MM-DD","start":"HH:MM or null","end":"HH:MM or null","allDay":true|false,"location":"","description":""}]}
ルール:
- row は入力の各行に付いた row 番号をそのまま入れる。
- title は必ず空でない文字列にする(見出しの「タイトル/件名/予定/内容」等の列、なければ最も予定名らしい列の値)。
- 見出し行・合計行・空行・予定でない行は出力しない。
- 年が不明な日付は「今日の日付」に最も近い未来の年で補完。
- 時刻がなければ allDay を true、start/end は null。
- 終了時刻がなければ end は null。
- 他の列の有用な情報は description にまとめる。`;


const TITLE_KEYS = ["title", "summary", "name", "subject", "event", "タイトル", "件名", "予定", "内容"];
const isDateTime = (v) => /^\s*[\d\/\-:.年月日時分\s~〜～–]+\s*$/.test(v);

function fallbackTitle(item) {
  if (!item) return "";
  const { header = [], row = [] } = item;
  const names = ["タイトル", "件名", "予定", "予定名", "イベント", "内容", "名称", "題名", "summary", "title", "subject", "name"];
  for (const n of names) {
    const i = header.findIndex((h) => String(h).trim().toLowerCase() === n);
    if (i >= 0 && String(row[i] ?? "").trim()) return String(row[i]).trim();
  }
  for (const c of row) {
    const v = String(c ?? "").trim();
    if (v && !isDateTime(v)) return v;
  }
  return "";
}

function normalize(ev, rows) {
  if (!ev || typeof ev !== "object") return null;
  let title = "";
  for (const k of TITLE_KEYS) {
    const v = ev[k];
    if (typeof v === "string" && v.trim() && v.trim() !== "null") { title = v.trim(); break; }
  }
  const idx = Number.isInteger(ev.row) ? ev.row : parseInt(ev.row, 10);
  if (!title) title = fallbackTitle(rows[idx]);
  if (!title) title = "(無題の予定)";
  const nul = (v) => (v == null || v === "null" || v === "" ? null : v);
  return {
    title,
    date: nul(ev.date),
    start: nul(ev.start),
    end: nul(ev.end),
    allDay: ev.allDay === true || ev.allDay === "true" || !nul(ev.start),
    location: nul(ev.location) || "",
    description: nul(ev.description) || "",
  };
}

function parseEvents(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { const d = JSON.parse(m[0]); if (Array.isArray(d.events)) return d.events; } catch (_) {} }
  // 途中で切れたJSONの救済: 完結しているイベントオブジェクトだけ拾う
  const out = [];
  for (const o of text.match(/\{[^{}]*\}/g) || []) {
    try { const d = JSON.parse(o); if (d && d.date) out.push(d); } catch (_) {}
  }
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/analyze" && req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === "/api/analyze" && req.method === "POST") {
      try {
        const { rows, today } = await req.json();
        const numbered = rows.map((r, i) => ({ row: i, header: r.header, cells: r.row }));
        const out = await env.AI.run(MODEL, {
          max_tokens: 2048,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "今日の日付: " + today + "\n" + JSON.stringify(numbered) },
          ],
        });
        const msg = out.choices && out.choices[0] && out.choices[0].message;
        const raw = typeof out.response === "string" ? out.response : (msg && msg.content) || out.response || out;
        const text = (typeof raw === "string" ? raw : JSON.stringify(raw)).replace(/<think>[\s\S]*?<\/think>/g, "");
        const events = parseEvents(text).map((e) => normalize(e, rows)).filter((e) => e && e.date);
        return json({ events });
      } catch (e) {
        return json({ error: String(e), events: [] }, 500);
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
