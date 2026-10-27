# 8棒接力：哪一棒是AI？ / 8-Leg Relay: Which One Is AI?

8個人接力畫一幅像素長卷，其中1棒由AI畫手「8號」畫。大家先給每一棒評分，再猜哪一棒是AI，最後揭曉。

Eight people draw one pixel scroll in relay. One leg is drawn by the AI artist “No. 8”. Everyone rates each leg, guesses which one is the AI, then the answer is revealed.

- 試玩 / Play: https://onholdlab.github.io/relay-ai-guess/
- 畫作、投票和留言存在 onholdlab 的 Supabase，資料表與函數在 `supabase/relay.sql`。
- Drawings, votes and comments are stored in onholdlab's Supabase; schema and functions are in `supabase/relay.sql`.

## 8號怎麼畫 / How No. 8 draws

每一卷的 AI 棒在開卷時隨機決定(第2到7棒)。上一棒交出後,網頁會提醒 Supabase Edge Function `relay-ai-draw` 只把上一棒最右邊 6 欄交給 Claude,請它輸出一筆一筆的繪圖動作(畫筆、直線、矩形、橢圓、填色),用跟玩家一樣的工具執行成這一棒。揭曉後可以重播 8 號的作畫過程。

Each scroll's AI leg is picked at random (legs 2–7) when the scroll opens. When the leg before it is submitted, the page nudges the `relay-ai-draw` Edge Function, which gives Claude only the last 6 columns of the previous leg and asks for a list of drawing strokes, which run through the same tools players use. After the reveal, anyone can replay how No. 8 drew.

## 多卷 / Multiple scrolls

一卷沒有能領的棒時,玩家可以選擇開下一卷(同時最多3卷在畫)。8棒畫完24小時後自動揭曉,過去的卷都會保留。

When no leg is free, a player can choose to open the next scroll (at most 3 in progress). Each scroll reveals 24 hours after leg 8, and past scrolls are kept.
