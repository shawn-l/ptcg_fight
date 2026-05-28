# CLAUDE_TODO.md

## 0. 【修改過的程序和修改內容】

本次對話對以下檔案進行了修改：

### `packages/engine/src/types.ts`
- `PendingChoice.kind`：從 `"DISCARD_FROM_HAND" | "SEARCH_DECK"` 擴展為 `"DISCARD_FROM_HAND" | "SEARCH_DECK" | "SELECT_POKEMON" | "SEARCH_DISCARD" | "OPTIONAL_EFFECT"`
- `PendingChoice.resolution`：新增 `DAMAGE_TO_SELECTED_POKEMON`、`MOVE_FROM_DISCARD_TO_HAND`、`MOVE_FROM_DISCARD_TO_DECK`、`OPTIONAL_EFFECT` 四種 resolution 類型
- `PendingChoice`：新增可選欄位 `remainingSteps?: EffectStep[]`（用於多階段選擇流程）
- `EffectStep`：新增 `SELECT_POKEMON`（選擇場上寶可夢）、`SEARCH_DISCARD`（從棄牌區選牌，filter 支援 OR 數組 + minCount）、`OPTIONAL_EFFECT`（是/否可選效果）
- `SEARCH_DECK` 和 `SEARCH_DISCARD` 的 `filter` 從單物件改為數組 `{ supertype?; subtypes?[] }[]`（支援 OR 匹配），新增可選 `minCount`（預設等於 count）

### `packages/engine/src/effects.ts`
- **重構**：`applyEffect` 內部邏輯提取為 `applyEffectSteps(state, steps, playerId, sourceActionId): GameEvent[]`，導出供 `resolver.ts` 的 `resolveChoice` 調用（OPTIONAL_EFFECT yesSteps 和多階段 remainingSteps 都需動態執行 steps）
- `applyEffectSteps` 的 for 循環改為 indexed loop（`for (let i = 0; ...)`），choice step 創建 pendingChoice 且後續還有 steps 時，將 `steps.slice(i + 1)` 存入 `pendingChoice.remainingSteps` 並 break
- `matchesDeckSearchFilter`：改為接收 filter 數組，使用 `filters.some(...)` 實現 OR 匹配
- 新增 `choiceOptionForSlot` helper：用 `"p2:active"` / `"p2:bench:0"` 格式為 PokemonSlot 生成 ChoiceOption
- 修復 `SEARCH_DECK` 的 `minSelections`/`maxSelections`：從硬編碼 `step.count` 改為 `Math.min(step.count, options.length)`，deck 無匹配時 `min=max=0`
- `CHOICE_REQUESTED` 事件的 minSelections/maxSelections 改為從 `state.pendingChoice` 讀取實際值
- 新增 effect registry entries：
  - `attack.snipe.bench.30`（bench snipe 30 傷害）
  - `trainer.retrieve.basic.1.to-hand`（棄牌區 → 手牌）
  - `trainer.retrieve.basic.1.to-deck`（棄牌區 → 牌庫 + 洗牌）
  - `trainer.super-rod.3.to-deck`（OR filter + minCount=0，最多 3 張回牌庫）
  - `trainer.draw.2-optional`（OPTIONAL_EFFECT：可選抽 2）
  - `trainer.draw.1-optional-then-draw.1`（OPTIONAL_EFFECT + 多階段：可選抽 1 → 再抽 1）
  - `trainer.rescue.retrieve-and-search`（兩階段：棄牌區回收 → 牌庫檢索）

### `packages/engine/src/resolver.ts`
- 導入 `placeDamageOnSlot`、`applyEffectSteps`
- `attack()`：effect 產生 pendingChoice 後新增 `if (state.pendingChoice) return` guard，阻止 auto pass-turn
- `resolveChoice` 新增四個 resolution handler：
  - `DAMAGE_TO_SELECTED_POKEMON`：解析 optionId → 定位 slot → 驗證 → `placeDamageOnSlot` → `checkKnockOuts`
  - `MOVE_FROM_DISCARD_TO_HAND`：驗證卡仍在 discard → 移除 → 加入 hand → `CARD_MOVED`（visibility: public）
  - `MOVE_FROM_DISCARD_TO_DECK`：驗證卡仍在 discard → 移除 → 加入 deck → 可選洗牌（`shuffleDeckDeterministically`）
  - `OPTIONAL_EFFECT`：選 Yes → 執行 `yesSteps`；選 No → 清除 `choice.remainingSteps`
- 每個 resolution 後統一檢查 `choice.remainingSteps`：若有 pendingChoice（yesSteps 可能創建新 choice），將 remainingSteps prepend 到新 choice；否則直接執行
- `checkKnockOuts` 重構為 `checkKnockOuts` + `handleKnockOut` helper：支援 bench KO（反向迭代 bench，splice 移除，不觸發 promotion）
- 新增 helper：`parseChoiceOptionId`、`resolveSlotFromChoiceOptionId`（用於解析 `"p2:bench:0"` 格式的 option ID）

### `packages/engine/src/mutations.ts`
- 新增 `placeDamageOnSlot(slot: PokemonSlot, amount: number)`：直接操作 slot 引用，用於 bench snipe

### `packages/engine/tests/phase4-choice.test.ts`
- 測試從 3 個 → 31 個（新增 28 個測試）
- 新增測試卡定義：`sniperPokemon`、`retrieveTrainer`、`retrieveToDeckTrainer`、`superRodTrainer`、`optionalDrawTrainer`、`rescueTrainer`
- 新增 helper：`startedGameSingleBasic`、`startedGameWithSniper`、`startedGameWithDiscardSetup`、`startedGameWithDiscardToDeckSetup`、`startedGameWithSuperRodSetup`、`startedGameOptionalDraw`、`startedGameRescue`
- 新增 describe blocks：`SELECT_POKEMON choice type`（6 tests）、`SEARCH_DISCARD choice type`（4 tests）、`MOVE_FROM_DISCARD_TO_DECK choice type`（2 tests）、`super rod and filter/minCount features`（3 tests）、`OPTIONAL_EFFECT choice type`（3 tests）、`multi-stage choice flow`（2 tests）
- 全局 helper：`findInHand`、`findCardInHand`

### `apps/server/src/rooms.ts`
- p1 牌庫加入 `sv1-nest-search` 卡片
- 新增 `nestSearchTrainer` 卡牌定義
- `cards` 改為 `[...sampleCards, nestSearchTrainer]` 的合併陣列

### `apps/debug-table/src/main.tsx`
- 修復 0-option 場景：當 `options.length === 0 && minSelections === 0` 時，顯示 "Confirm (no valid targets)" 按鈕以提交空選擇

---

## 1. 【📌 當前中斷點】

最後停在 **多階段選擇流程（multi-stage choice flow）**。此功能已通過測試、型別檢查與 build（51 tests 全部通過）。

### 最後處理的核心邏輯

- `packages/engine/src/effects.ts` 的 `applyEffectSteps`：
  - indexed loop + break 邏輯（line ~118）
  - choice step 創建 pendingChoice 後，`steps.slice(i + 1)` 存入 `remainingSteps`

- `packages/engine/src/resolver.ts` 的 `resolveChoice` 結尾：
  - `remainingSteps` 的統一處理邏輯：若有新 pendingChoice 則 prepend，否則直接執行

### 尚未寫測試的邏輯路徑（⚠️ 明確標註）

**OPTIONAL_EFFECT Yes → yesSteps 內含 choice → remainingSteps 的交互未測試**。計劃中有這個測試（"OPTIONAL_EFFECT Yes：yesSteps + remainingSteps 都執行"），但實際只寫了「No 清除 remainingSteps」的測試。這段代碼邏輯依賴 `state.pendingChoice` 的條件判斷（resolver.ts 中 `if (state.pendingChoice) { ... prepend ... }`），但無專門的 test case 覆蓋。**接手後建議優先補上這個測試**。

---

## 2. 【❌ 已知問題 / 待修正】

目前沒有已知的編譯錯誤或測試失敗。

最後驗證結果：
- `npx pnpm@8.15.9 test`：7 個 test files 通過，51 個 tests 通過
- `npx pnpm@8.15.9 typecheck`：通過
- `npx pnpm@8.15.9 build`：通過

待修正/補強項目：

- **缺少 OPTIONAL_EFFECT Yes + remainingSteps 交互測試**：見第 1 節標註，代碼邏輯存在但未測試。測試場景：effect steps = [OPTIONAL_EFFECT(then=[SEARCH_DISCARD]), draw]，選 Yes → SEARCH_DISCARD choice 出現 → resolve → draw 執行
- **Debug UI 的 multi-select 未實現**：debug-table 總是發送 `selectedOptionIds: [option.id]`（單選）。引擎支持多選，但 UI 無複選框或確認多選的交互。這限制了 `count > 1` 的效果在瀏覽器端的可用性
- **`checkKnockOuts` 的 bench KO 與 active KO 同時發生**：目前 bench KO 和 active KO 分別由不同攻擊路徑觸發，但理論上如果一個攻擊同時對 active 造成傷害 + snipe bench 導致兩者同時 KO，`handleKnockOut` 的調用順序可能有 edge case（先處理 active KO 導致 game-over，跳過 bench KO 的 prize 發放）。目前無測試覆蓋此場景
- **`choice.remainingSteps` 與 `yesSteps` 的 prepend 順序**：當 yesSteps 創建新 choice 時，原 remainingSteps 被 prepend 到新 choice。如果 yesSteps 中有多個 choice step（遞歸深度 > 1），prepend 語義可能需要調整為追加而非前置。目前無深層嵌套測試
- **Server WebSocket broadcast 無 per-player 事件過濾**：`apps/server/src/index.ts` 的 `broadcast` 函數將未過濾的 `ResolveResult`（包含所有 GameEvent）發送給所有 WebSocket 客戶端。私有事件（如 `CARD_DRAWN`、`PRIZE_TAKEN`）的 payload 會在網絡層洩漏給對手。對 local-network prototype 影響有限，但生產環境需修復

---

## 3. 【📝 後續待辦清單 (TODO)】

### 1. 補上 OPTIONAL_EFFECT Yes + remainingSteps 交互測試（最高優先級）
- 這是最後一個「已知缺少測試」的邏輯路徑
- 在 `packages/engine/tests/phase4-choice.test.ts` 新增測試：
  - Effect steps = `[OPTIONAL_EFFECT(then=[SEARCH_DISCARD]), draw]`
  - 選 Yes → 驗證 SEARCH_DISCARD pendingChoice 出現 → resolve → 驗證 draw 執行
  - 確保 `remainingSteps` 的 prepend 邏輯正確
- 如需定義新的測試 effect，在 `effects.ts` 添加或用內聯卡片

### 2. 實作「從手牌/場上選能量」choice 類型（功能擴展）
- 這是 CLAUDE_TODO.md TODO #3 中最後一個未實現的 choice 類型
- 模式類似 `SELECT_POKEMON`：遍歷手牌中的 Energy 卡 和/或 場上寶可夢的 attachedEnergy
- 兩種子場景：
  - a) 從手牌選能量（如「從手牌選 1 張能量，貼給己方寶可夢」）
  - b) 從場上選能量（如「選擇對手寶可夢身上的 1 張能量，丟棄之」）
- 擴展 `EffectStep`（新 choice kind）、`PendingChoice`（新 resolution）、handler + tests
- 可與多階段流程結合（選能量 → 選目標寶可夢 = 兩階段）

### 3. Debug UI 多選支持 + 同步 CLAUDE_TODO.md
- 修改 `apps/debug-table/src/main.tsx`：為 `pendingChoice` 面板添加複選邏輯（checkbox + confirm button）
- 當 `maxSelections > 1` 時，允許多選並發送 `selectedOptionIds: [...]`
- 完成後更新 CLAUDE_TODO.md，反映所有 TODO #3 項目已關閉

---

## 附錄：Choice System 完整能力矩陣

| Choice 類型 | 用途 | 來源 Zone | 目標 Zone | 多選支持 | OR Filter | minCount |
|---|---|---|---|---|---|---|
| `DISCARD_FROM_HAND` | 手牌棄牌 | hand | discard | count | — | — |
| `SEARCH_DECK` | 牌庫檢索 | deck | hand | count | ✅ | ✅ |
| `SELECT_POKEMON` | 目標選擇 | active/bench | —（inline effect） | count | — | — |
| `SEARCH_DISCARD` | 棄牌區回收 | discard | hand 或 deck | count | ✅ | ✅ |
| `OPTIONAL_EFFECT` | 是/否可選 | — | —（yesSteps） | 1（Yes/No） | — | — |
| 多階段流程 | 連續 choices | 任意 | 任意 | 繼承各 choice | ✅ | ✅ |

## 附錄：Effect Registry 完整列表

| Effect ID | Trigger | Choice Type | 說明 |
|---|---|---|---|
| `trainer.draw.2` | trainer-played | — | 直接抽 2 |
| `trainer.discard.1.draw.2` | trainer-played | DISCARD_FROM_HAND | 棄 1 抽 2 |
| `trainer.search.basic.1.to-hand` | trainer-played | SEARCH_DECK | 牌庫檢索 Basic Pokemon |
| `attack.damage.20` | attack | — | 對對手 active 造成 20 傷害 |
| `attack.snipe.bench.30` | attack | SELECT_POKEMON | bench snipe 30 |
| `trainer.retrieve.basic.1.to-hand` | trainer-played | SEARCH_DISCARD | 棄牌區回收 → 手牌 |
| `trainer.retrieve.basic.1.to-deck` | trainer-played | SEARCH_DISCARD | 棄牌區回收 → 牌庫 + 洗牌 |
| `trainer.super-rod.3.to-deck` | trainer-played | SEARCH_DISCARD | Pokemon OR Basic Energy，最多 3 張 → 牌庫 |
| `trainer.draw.2-optional` | trainer-played | OPTIONAL_EFFECT | 可選抽 2 |
| `trainer.draw.1-optional-then-draw.1` | trainer-played | OPTIONAL_EFFECT | 多階段：可選抽 1 + 一定抽 1 |
| `trainer.rescue.retrieve-and-search` | trainer-played | SEARCH_DISCARD → SEARCH_DECK | 兩階段：回收 + 檢索 |
