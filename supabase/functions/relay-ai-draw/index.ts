// 8號畫一棒:讀上一棒最右邊6格,請 Claude 用筆畫畫完這一棒,存進 AI 那棒。
// 需要的 secret:ANTHROPIC_API_KEY。SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自動提供。
// ---- 筆畫執行與給 8號的指令(與 js/strokes.js 相同) ----
/* 8號的筆畫:AI 輸出繪圖動作,用跟真人一樣的工具執行。瀏覽器與 Supabase Edge Function 共用。
   stroke 格式:
   {tool:"pen"|"erase", color:0-15, size:1-4, points:[[x,y],...]}   連續筆畫
   {tool:"line", color, size, from:[x,y], to:[x,y]}
   {tool:"rect"|"ellipse", color, size, from:[x,y], to:[x,y], solid:bool}
   {tool:"fill", color, at:[x,y]}
   座標:x 0-47, y 0-63(只在自己這棒的畫布內)。 */
(function (root) {
  var W = 48, H = 64, MAX = 300;
  function cl(v, lo, hi) { v = Math.round(+v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }
  function pt(p) { return Array.isArray(p) ? { x: cl(p[0], 0, W - 1), y: cl(p[1], 0, H - 1) } : null; }
  function clean(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX; i++) {
      var s = list[i] || {}, t = s.tool, c = cl(s.color, 0, 15), z = cl(s.size || 1, 1, 4);
      if ((t === 'pen' || t === 'erase') && Array.isArray(s.points)) {
        var ps = s.points.slice(0, 200).map(pt).filter(Boolean);
        if (ps.length) out.push({ tool: t, color: c, size: z, points: ps.map(function (q) { return [q.x, q.y]; }) });
      } else if ((t === 'line' || t === 'rect' || t === 'ellipse') && pt(s.from) && pt(s.to)) {
        var a = pt(s.from), b = pt(s.to);
        out.push({ tool: t, color: c, size: z, from: [a.x, a.y], to: [b.x, b.y], solid: !!s.solid });
      } else if (t === 'fill' && pt(s.at)) {
        var f = pt(s.at); out.push({ tool: 'fill', color: c, at: [f.x, f.y] });
      }
    }
    return out;
  }
  function apply(cur, s) {
    var col = s.tool === 'erase' ? 0 : s.color, size = s.size || 1;
    function put(x, y) { var o = (size - 1) >> 1; for (var j = 0; j < size; j++) for (var i = 0; i < size; i++) { var a = x - o + i, b = y - o + j; if (a >= 0 && b >= 0 && a < W && b < H) cur[b * W + a] = col; } }
    function line(a, b, c, d) { var dx = Math.abs(c - a), dy = -Math.abs(d - b), sx = a < c ? 1 : -1, sy = b < d ? 1 : -1, e = dx + dy; for (;;) { put(a, b); if (a === c && b === d) break; var e2 = 2 * e; if (e2 >= dy) { e += dy; a += sx; } if (e2 <= dx) { e += dx; b += sy; } } }
    if (s.tool === 'pen' || s.tool === 'erase') { var p = s.points; put(p[0][0], p[0][1]); for (var k = 1; k < p.length; k++) line(p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]); return; }
    if (s.tool === 'line') return line(s.from[0], s.from[1], s.to[0], s.to[1]);
    if (s.tool === 'fill') {
      var x0 = s.at[0], y0 = s.at[1], t = cur[y0 * W + x0]; if (t === col) return;
      var st = [[x0, y0]]; while (st.length) { var q = st.pop(), a = q[0], b = q[1]; if (a < 0 || b < 0 || a >= W || b >= H || cur[b * W + a] !== t) continue; cur[b * W + a] = col; st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]); }
      return;
    }
    var X0 = Math.min(s.from[0], s.to[0]), X1 = Math.max(s.from[0], s.to[0]), Y0 = Math.min(s.from[1], s.to[1]), Y1 = Math.max(s.from[1], s.to[1]);
    if (s.tool === 'rect') { if (s.solid) { for (var y = Y0; y <= Y1; y++) for (var x = X0; x <= X1; x++) cur[y * W + x] = col; } else { line(X0, Y0, X1, Y0); line(X0, Y1, X1, Y1); line(X0, Y0, X0, Y1); line(X1, Y0, X1, Y1); } return; }
    var cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2, rx = (X1 - X0) / 2 + .5, ry = (Y1 - Y0) / 2 + .5;
    for (var yy = Y0; yy <= Y1; yy++) for (var xx = X0; xx <= X1; xx++) { var d = Math.pow((xx - cx) / rx, 2) + Math.pow((yy - cy) / ry, 2); if (d <= 1 && (s.solid || rx <= size || ry <= size || Math.pow((xx - cx) / (rx - size), 2) + Math.pow((yy - cy) / (ry - size), 2) > 1)) cur[yy * W + xx] = col; }
  }
  /* 回傳最終像素(hex 字串,與畫布格式相同);upto 只畫前 n 筆,用於重播 */
  /* 填色如果在開頭3筆之後一次蓋掉超過35%的畫布,視為漏色,跳過(等於真人按了復原) */
  function render(list, upto) {
    var cur = new Uint8Array(W * H), n = upto == null ? list.length : upto;
    for (var i = 0; i < n && i < list.length; i++) {
      if (list[i].tool === 'fill' && i >= 3) {
        var before = cur.slice(); apply(cur, list[i]);
        var ch = 0; for (var k = 0; k < cur.length; k++) if (cur[k] !== before[k]) ch++;
        if (ch > cur.length * 0.35) cur = before;
      } else apply(cur, list[i]);
    }
    return Array.from(cur, function (v) { return v.toString(16); }).join('');
  }
  /* 給 8號的指令:只附上一棒最右邊 6 欄(tail 是 64 行、每行 6 個 16 進位字元) */
  const PALETTE = ["0 白 #F4F6F8", "1 淺灰 #C9D1D9", "2 灰 #7C8896", "3 深灰 #2B3440", "4 近黑 #0B1220", "5 紅 #E5484D", "6 橘 #F76B15", "7 琥珀 #FFB400", "8 黃 #F5E663", "9 淺綠 #8BD450", "10 綠 #2EA043", "11 青 #2AC4B3", "12 藍 #2F4BFF", "13 紫 #6E56CF", "14 粉 #E26BD1", "15 棕 #8B5A3C"];
  function prompt(tail) {
    return `你在玩一個接力畫畫遊戲。每個人畫一段 48 格寬、64 格高的像素畫,接在上一段的右邊,拼成一幅長卷。你只看得到上一段最右邊的 6 欄。
  你的任務:接著上一段畫完你這一段,讓畫面在接縫處自然接上,之後自由發揮,畫一段有內容、看起來像玩家在手機上大約花 10 分鐘畫出來的作品。
  
  規則:
  - 只能用這 16 色,用編號表示:
  ${PALETTE.join("\n")}
  - 畫布起始是全白(0)。座標 x 0-47(左到右)、y 0-63(上到下)。你的 x=0 緊接在上一段 x=47 的右邊。
  - 只能用下面的工具,一筆一筆畫(和玩家用的工具一樣):
    {"tool":"pen","color":C,"size":1-4,"points":[[x,y],...]}  連續筆畫,點與點之間自動連線
    {"tool":"erase","size":1-4,"points":[[x,y],...]}
    {"tool":"line","color":C,"size":1-4,"from":[x,y],"to":[x,y]}
    {"tool":"rect" 或 "ellipse","color":C,"size":1-4,"from":[x,y],"to":[x,y],"solid":true 或 false}
    {"tool":"fill","color":C,"at":[x,y]}  油漆桶,只會填滿相連的同色區域;邊界沒封好會漏出去
  - 筆數 25 到 90 筆。不要寫字。
  
  上一段最右邊 6 欄(每行是一個 y,由上到下;每個字元是那一格的顏色編號,用 16 進位 0-f):
  ${tail.join("\n")}
  
  只輸出一個 JSON 物件,不要任何其他文字:{"strokes":[...]}`;
  }
  function tailOf(px) { var t = []; for (var y = 0; y < H; y++) t.push(px.slice(y * W + W - 6, y * W + W)); return t; }
  var api = { clean: clean, render: render, prompt: prompt, tailOf: tailOf, W: W, H: H, MAX: MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Strokes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ----
const S = (globalThis as any).Strokes;
const URL_ = Deno.env.get("SUPABASE_URL")!;
// 新版專案用 sb_secret_ 金鑰,舊版用 service_role JWT;兩種都支援
const SRK = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const AUTH: Record<string, string> = SRK.startsWith("sb_") ? { apikey: SRK } : { apikey: SRK, Authorization: "Bearer " + SRK };
const KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("RELAY_AI_MODEL") || "claude-sonnet-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = (path: string, init: RequestInit = {}) => fetch(URL_ + "/rest/v1/" + path, { ...init, headers: { ...AUTH, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } }).then(async r => { if (!r.ok) throw new Error(path + " " + r.status + " " + await r.text()); return r.json(); });
async function sha256(t: string) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }

// 誰都可以「提醒」8號(玩家交出一棒後網頁會自動呼叫):只有在 AI 那棒的上一棒畫完、AI 那棒還沒畫時才會真的畫。
// 一般玩家呼叫一律立刻回 {ok:true},不透露哪一棒是 AI;主辦方帶密語呼叫則會等畫完並回報結果。
async function draw(scroll: number) {
  const sec = await db(`relay_secret?select=ai_slot&scroll=eq.${scroll}`);
  const k = sec[0]?.ai_slot;
  if (!k) return { error: "no_ai_slot", status: 400 };
  const sl = await db(`relay_slots?select=n,px&scroll=eq.${scroll}&n=in.(${k - 1},${k})`);
  const prev = sl.find((x: any) => x.n === k - 1), me = sl.find((x: any) => x.n === k);
  if (!prev?.px) return { error: "prev_not_done", status: 400 };
  if (me?.px) return { error: "already_done", status: 400 };
  // 上鎖,避免同時畫兩次;失敗的話5分鐘後可再試
  const until = new Date(Date.now() - 5 * 60e3).toISOString();
  const lock = await db(`relay_secret?scroll=eq.${scroll}&or=(locked_at.is.null,locked_at.lt.${until})`, { method: "PATCH", body: JSON.stringify({ locked_at: new Date().toISOString() }) });
  if (!lock.length) return { error: "already_drawing", status: 409 };
  const tail: string[] = []; for (let y = 0; y < 64; y++) tail.push(prev.px.slice(y * 48 + 42, y * 48 + 48));
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: S.prompt(tail) }] }) });
  const j = await r.json();
  if (!r.ok) return { error: "model_failed", detail: j?.error?.message || r.status, status: 502 };
  const text = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  const strokes = S.clean(m ? JSON.parse(m[0]).strokes : []);
  if (strokes.length < 5) return { error: "too_few_strokes", status: 502 };
  const px = S.render(strokes), now = new Date().toISOString();
  await db(`relay_secret?scroll=eq.${scroll}`, { method: "PATCH", body: JSON.stringify({ ops: strokes, model: MODEL }) });
  const up = await db(`relay_slots?scroll=eq.${scroll}&n=eq.${k}&px=is.null`, { method: "PATCH", body: JSON.stringify({ px, done_at: now, last_at: now }) });
  if (!up.length) return { error: "already_done", status: 409 };
  // 8棒都畫完就記下完成時間(24小時後自動揭曉)
  const cnt = await db(`relay_slots?select=n&scroll=eq.${scroll}&px=not.is.null`);
  if (cnt.length === 8) await db(`relay_scrolls?id=eq.${scroll}&done_at=is.null`, { method: "PATCH", body: JSON.stringify({ done_at: now }) });
  return { ok: true, strokes: strokes.length, status: 200 };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { token, scroll } = await req.json().catch(() => ({}));
    const sc = Math.floor(+scroll);
    if (!(sc >= 1)) return reply({ error: "bad_input" }, 400);
    const host = token ? (await db("relay_host?select=token_hash&token_hash=eq." + await sha256(token))).length > 0 : false;
    if (!KEY) return host ? reply({ error: "no_api_key" }, 500) : reply({ ok: true });
    if (!host) {
      const job = draw(sc).catch(() => null);
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(job); else await job;
      return reply({ ok: true });
    }
    const { status, ...out } = await draw(sc);
    return reply(out, status);
  } catch (e) { return reply({ error: "failed", detail: String(e).slice(0, 300) }, 500); }
});
