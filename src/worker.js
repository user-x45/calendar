const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200) => Response.json(obj, { status, headers: CORS });

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

const SYSTEM = `あなたはExcelの行データからカレンダー予定を抽出するアシスタントです。
入力は表の先頭行(見出し)と複数の行です。予定として登録すべき行だけを判断し、次のJSONのみを出力してください。説明文は禁止。
{"events":[{"title":"","date":"YYYY-MM-DD","start":"HH:MM or null","end":"HH:MM or null","allDay":true|false,"location":"","description":""}]}
ルール:
- 見出し行・合計行・空行・予定でない行は出力しない。
- 年が不明な日付は「今日の日付」に最も近い未来の年で補完。
- 時刻がなければ allDay を true、start/end は null。
- 終了時刻がなければ end は null。
- 他の列の有用な情報は description にまとめる。`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/analyze" && req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === "/api/analyze" && req.method === "POST") {
      try {
        const { rows, today } = await req.json();
        const out = await env.AI.run(MODEL, {
          max_tokens: 2048,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "今日の日付: " + today + "\n" + JSON.stringify(rows) },
          ],
        });
        const msg = out.choices && out.choices[0] && out.choices[0].message;
        const raw = typeof out.response === "string" ? out.response : (msg && msg.content) || out.response || out;
        const text = typeof raw === "string" ? raw : JSON.stringify(raw);
        const m = text.match(/\{[\s\S]*\}/);
        const data = m ? JSON.parse(m[0]) : { events: [] };
        return json({ events: Array.isArray(data.events) ? data.events : [] });
      } catch (e) {
        return json({ error: String(e), events: [] }, 500);
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
