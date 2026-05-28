export type RegulationMark = "E" | "F" | "G";

export type Supertype = "Pokemon" | "Trainer" | "Energy";

export type CardDefinition = {
  id: string;
  languageRefs: {
    en: {
      name: string;
      rulesText?: string;
    };
    zhHans?: {
      name: string;
      rulesText?: string;
      setCode?: string;
      collectorNumber?: string;
    };
  };
  regulationMark: RegulationMark;
  supertype: Supertype;
  subtypes: string[];
  evolvesFrom?: string;
  hp?: number;
  types?: string[];
  weakness?: { type: string; multiplier: number };
  resistance?: { type: string; reduction: number };
  retreatCost?: number;
  prizeCardsWhenKnockedOut?: number;
  attacks?: CardAttack[];
  abilities?: CardAbility[];
  rulesText?: string[];
  effectRefs: string[];
};

export type CardAttack = {
  name: string;
  cost: string[];
  damage?: number;
  text?: string;
  effectRef?: string;
};

export type CardAbility = {
  name: string;
  text: string;
  effectRef?: string;
};

export type CatalogValidationReport = {
  valid: boolean;
  errors: string[];
};

export function getCardById(cards: CardDefinition[], id: string): CardDefinition | undefined {
  return cards.find((card) => card.id === id);
}

export function validateCardCatalog(cards: CardDefinition[]): CatalogValidationReport {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    if (seen.has(card.id)) {
      errors.push(`Duplicate card id: ${card.id}`);
    }
    seen.add(card.id);

    if (!["E", "F", "G"].includes(card.regulationMark)) {
      errors.push(`Unsupported regulation mark for ${card.id}: ${card.regulationMark}`);
    }
    if (!card.languageRefs.en?.name) {
      errors.push(`Missing English name for ${card.id}`);
    }
    if (card.supertype === "Pokemon") {
      if (!card.hp || card.hp <= 0) {
        errors.push(`Pokemon ${card.id} must have positive HP`);
      }
      if (card.prizeCardsWhenKnockedOut !== undefined && card.prizeCardsWhenKnockedOut < 1) {
        errors.push(`Pokemon ${card.id} must give at least one Prize card when Knocked Out`);
      }
      if (!card.subtypes.length) {
        errors.push(`Pokemon ${card.id} must include at least one subtype`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

const pokemon = (
  id: string,
  regulationMark: RegulationMark,
  en: string,
  zhHans: string,
  hp: number,
  type: string,
  attacks: CardAttack[] = [{ name: "Tackle", cost: [type], damage: 10 }],
  options: { subtypes?: string[]; evolvesFrom?: string; retreatCost?: number; prizeCardsWhenKnockedOut?: number } = {}
): CardDefinition => ({
  id,
  languageRefs: {
    en: { name: en },
    zhHans: { name: zhHans }
  },
  regulationMark,
  supertype: "Pokemon",
  subtypes: options.subtypes ?? ["Basic"],
  evolvesFrom: options.evolvesFrom,
  hp,
  types: [type],
  retreatCost: options.retreatCost ?? 1,
  prizeCardsWhenKnockedOut: options.prizeCardsWhenKnockedOut,
  attacks,
  rulesText: [],
  effectRefs: attacks.flatMap((attack) => (attack.effectRef ? [attack.effectRef] : []))
});

const energy = (
  id: string,
  regulationMark: RegulationMark,
  en: string,
  zhHans: string,
  type: string
): CardDefinition => ({
  id,
  languageRefs: {
    en: { name: en },
    zhHans: { name: zhHans }
  },
  regulationMark,
  supertype: "Energy",
  subtypes: ["Basic"],
  types: [type],
  rulesText: [],
  effectRefs: []
});

const trainer = (
  id: string,
  regulationMark: RegulationMark,
  en: string,
  zhHans: string,
  subtype: "Item" | "Supporter" | "Stadium",
  effectRef: string
): CardDefinition => ({
  id,
  languageRefs: {
    en: { name: en, rulesText: "Draw 2 cards." },
    zhHans: { name: zhHans, rulesText: "抽出2张卡。" }
  },
  regulationMark,
  supertype: "Trainer",
  subtypes: [subtype],
  rulesText: ["Draw 2 cards."],
  effectRefs: [effectRef]
});

export const sampleCards: CardDefinition[] = [
  pokemon("sv1-001", "G", "Sprigatito", "新叶喵", 70, "Grass", [
    { name: "Scratch", cost: ["Grass"], damage: 10 },
    { name: "Leafage", cost: ["Grass"], damage: 20, effectRef: "attack.damage.20" }
  ]),
  pokemon("sv1-002", "G", "Lechonk", "爱吃豚", 70, "Colorless"),
  energy("sv1-003", "G", "Basic Grass Energy", "基本草能量", "Grass"),
  energy("sv1-004", "G", "Basic Grass Energy", "基本草能量", "Grass"),
  trainer("sv1-005", "F", "Practice Gear", "练习装备", "Item", "trainer.draw.2"),
  pokemon("sv1-006", "F", "Pawmi", "布拨", 60, "Lightning"),
  pokemon("sv1-007", "E", "Bidoof", "大牙狸", 70, "Colorless"),
  trainer("sv1-008", "E", "Research Note", "研究笔记", "Supporter", "trainer.draw.2"),
  energy("sv1-009", "F", "Basic Lightning Energy", "基本雷能量", "Lightning"),
  pokemon("sv1-010", "G", "Floragato", "蒂蕾喵", 90, "Grass", [
    { name: "Slash", cost: ["Grass"], damage: 40 }
  ], { subtypes: ["Stage 1"], evolvesFrom: "Sprigatito", retreatCost: 1 }),
  pokemon("sv1-011", "G", "Smoliv", "迷你芙", 60, "Grass"),
  pokemon("sv1-012", "F", "Shinx", "小猫怪", 60, "Lightning"),
  pokemon("sv1-013", "E", "Hoppip", "毽子草", 50, "Grass"),
  pokemon("sv1-101", "G", "Fuecoco", "呆火鳄", 80, "Fire"),
  pokemon("sv1-102", "G", "Tarountula", "团珠蛛", 50, "Grass"),
  energy("sv1-103", "G", "Basic Fire Energy", "基本火能量", "Fire"),
  energy("sv1-104", "G", "Basic Fire Energy", "基本火能量", "Fire"),
  trainer("sv1-105", "F", "Practice Gear", "练习装备", "Item", "trainer.draw.2"),
  pokemon("sv1-106", "F", "Fidough", "狗仔包", 60, "Psychic"),
  pokemon("sv1-107", "E", "Starly", "姆克儿", 60, "Colorless"),
  trainer("sv1-108", "E", "Research Note", "研究笔记", "Supporter", "trainer.draw.2"),
  energy("sv1-109", "F", "Basic Fire Energy", "基本火能量", "Fire")
];
