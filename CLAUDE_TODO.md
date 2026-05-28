# CLAUDE_TODO.md

## 1. 【📌 當前中斷點】

目前最後停在「第三/第四階段的選擇系統擴展」：已完成 **牌庫檢索型 choice effect**。

最後處理的核心檔案與位置：

- `packages/engine/src/effects.ts`
  - 新增 effect registry：
    - `trainer.search.basic.1.to-hand`
  - 在 `applyEffect()` 中支援：
    - `SEARCH_DECK`
    - 依條件從牌庫產生可選項
    - 建立 `GameState.pendingChoice`

- `packages/engine/src/resolver.ts`
  - 在 `resolveChoice()` 中新增：
    - `MOVE_FROM_DECK_TO_HAND`
    - 驗證所選牌仍在 deck
    - 將牌從 deck 移到 hand
    - 發出 `CARD_MOVED`
    - 發出 `DECK_SHUFFLED`
  - 新增 deterministic shuffle：
    - `shuffleDeckDeterministically()`
    - `nextRandomState()`
    - `hashString()`

- `packages/engine/src/types.ts`
  - `PendingChoice.kind` 新增 `SEARCH_DECK`
  - `PendingChoice.resolution` 新增 `MOVE_FROM_DECK_TO_HAND`
  - `GameEvent.type` 新增 `DECK_SHUFFLED`
  - `EffectStep` 新增 deck search choice DSL 型別

- `packages/engine/tests/phase4-choice.test.ts`
  - 新增測試：
    - `searches the deck through a pending choice and moves the selected card to hand`

目前沒有寫到一半的程式碼。這一步的功能已通過測試、型別檢查與 build。

但邏輯仍屬於「最小可用」版本：
- 牌庫檢索目前只支援「從 deck 選 Basic Pokemon 到 hand」這一種 DSL。
- 尚未支援 reveal 的公開事件語義。
- 尚未支援可選檢索、找不到目標時可選擇不拿、或更複雜的 filter 條件。
- 洗牌目前是 deterministic mock shuffle，適合測試與回放，但未接入真正的對局隨機源/種子協議。

## 2. 【❌ 已知問題 / 待修正】

目前沒有已知編譯錯誤或測試失敗。

最後驗證結果：

- `npx pnpm@8.15.9 test`
  - 7 個 test files 通過
  - 23 個 tests 通過

- `npx pnpm@8.15.9 typecheck`
  - 通過

- `npx pnpm@8.15.9 build`
  - 通過

尚未完整測試或仍需補強的地方：

- Debug UI 目前可渲染 pending choice，但尚未針對 `SEARCH_DECK` 做瀏覽器端實測驗收。
- `DECK_SHUFFLED` 事件目前只記錄公開洗牌事件，沒有更完整的 hidden-zone replay/visibility 測試。
- `SEARCH_DECK` 沒有測「無可選目標」情境。
- 沒有測「pending choice 建立後，deck 狀態被其他效果改變」的防禦路徑；目前 resolver 已驗證所選牌仍在 deck，但缺少專門測試。
- 尚未實作 PTCG 中大量常見 choice 類效果：
  - 選擇己方/對方寶可夢
  - 從棄牌區選牌
  - 從手牌/場上選能量
  - 選擇是否執行 optional effect
  - 多階段選擇流程

## 3. 【📝 後續待辦清單 (TODO)】

1. 補齊 choice system 的下一個通用能力：目標選擇
   - 從 `packages/engine/src/types.ts` 開始擴充 `PendingChoice.kind` 與 `EffectStep`
   - 建議新增：
     - `SELECT_POKEMON`
     - 支援 active / bench / self / opponent filters
   - 在 `packages/engine/tests/phase4-choice.test.ts` 先寫 failing test，再改 resolver。

2. 補上 `SEARCH_DECK` 的邊界測試
   - 測 deck 中沒有符合條件的 Basic Pokemon 時應如何處理。
   - 測非法選擇、重複選擇、選擇數量不足/過多。
   - 測 `DECK_SHUFFLED` visibility 不洩漏 deck 順序。
   - 測公開 state serialization 不暴露 hidden deck card ids。

3. 開始導入更多 E/F/G 代表卡的效果 golden tests
   - 在 `packages/cards/src/index.ts` 或測試內新增代表卡定義。
   - 每類效果先選 1 張代表卡：
     - 檢索牌庫
     - 從棄牌區回收
     - 對 bench 放傷害
     - 換位
     - 附能
     - optional draw/search
   - 每張卡至少建立：
     - 正常結算測試
     - 無合法目標測試
     - 非法選擇測試
