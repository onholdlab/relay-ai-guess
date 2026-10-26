# 8棒接力：哪一棒是AI？ / 8-Leg Relay: Which One Is AI?

8個人接力畫一幅像素長卷，其中1棒由AI畫手「8號」畫。大家先給每一棒評分，再猜哪一棒是AI，最後揭曉。

Eight people draw one pixel scroll in relay. One leg is drawn by the AI artist “No. 8”. Everyone rates each leg, guesses which one is the AI, then the answer is revealed.

- 試玩 / Play: https://onholdlab.github.io/relay-ai-guess/
- 畫作、投票和留言存在 onholdlab 的 Supabase，資料表與函數在 `supabase/relay.sql`。
- Drawings, votes and comments are stored in onholdlab's Supabase; schema and functions are in `supabase/relay.sql`.

## 8號怎麼畫 / How No. 8 draws

主辦方按「讓8號畫這一棒」後,Supabase Edge Function `relay-ai-draw` 只把上一棒最右邊 6 欄交給 Claude,請它輸出一筆一筆的繪圖動作(畫筆、直線、矩形、橢圓、填色),用跟玩家一樣的工具執行成這一棒。揭曉後可以重播 8 號的作畫過程。

The host taps "Let No. 8 draw this leg". The `relay-ai-draw` Edge Function gives Claude only the last 6 columns of the previous leg and asks for a list of drawing strokes, which run through the same tools players use. After the reveal, anyone can replay how No. 8 drew.
