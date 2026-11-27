import z from 'zod';

export const tiers = ['Easy', 'Medium', 'Hard', 'Unfair', 'Bruh'] as const;
const entry = z
  .object({
    Item: z.string().regex(/^[a-z0-9_.-]{1,100}$/),
    Min: z.number().int().min(1).max(100000),
    Max: z.number().int().min(1).max(100000),
    Weight: z.number().int().min(1).max(100000),
  })
  .refine((e) => e.Max >= e.Min, 'Maximum quantity must cover minimum');
const pool = z.object({
  Name: z.string().trim().min(1).max(80),
  Chance: z.number().int().min(0).max(10000),
  Entries: z.array(entry).min(1).max(200),
});
export const lootSchema = z
  .object({
    Name: z.string().trim().min(1).max(80),
    Rolls: z.number().int().min(0).max(200),
    Entries: z.array(entry).max(200),
    Guaranteed: z.array(entry).max(200),
    Cascade: z.array(pool).min(1).max(12).optional(),
  })
  .refine((table) => table.Rolls === 0 || table.Entries.length > 0 || table.Cascade?.length, {
    message: 'Add a drop pool or set rolls to zero.',
    path: ['Cascade'],
  });
export type Loot = z.infer<typeof lootSchema>;
export type LootEntry = z.infer<typeof entry>;
export type LootPool = z.infer<typeof pool>;
export const starter: Loot = {
  Name: 'Starter',
  Rolls: 2,
  Entries: [{ Item: 'scrap', Min: 10, Max: 25, Weight: 1 }],
  Guaranteed: [],
};

export function cascadeOdds(pools: LootPool[]) {
  let remaining = 1;
  const hits = pools.map(({ Chance }) => {
    const hit = remaining * (Chance / 10000);
    remaining -= hit;
    return hit;
  });
  return { hits, remaining };
}

function pick(entries: LootEntry[], random: () => number) {
  let draw = random() * entries.reduce((total, item) => total + item.Weight, 0);
  return entries.find((item) => (draw -= item.Weight) < 0) ?? entries.at(-1);
}

export function simulate(table: Loot, runs = 100, random = Math.random) {
  const totals = new Map<string, number>();
  const tierHits = table.Cascade?.map(() => 0) ?? [];
  let misses = 0;
  function add(e: LootEntry) {
    totals.set(e.Item, (totals.get(e.Item) ?? 0) + e.Min + Math.floor(random() * (e.Max - e.Min + 1)));
  }
  for (let i = 0; i < runs; i++) {
    table.Guaranteed.forEach(add);
    for (let j = 0; j < table.Rolls; j++) {
      const hit = table.Cascade?.findIndex((pool) => Math.floor(random() * 10000) < pool.Chance);
      const entries = hit === undefined ? table.Entries : hit < 0 ? [] : table.Cascade![hit].Entries;
      const item = entries.length ? pick(entries, random) : undefined;
      if (item) {
        if (hit !== undefined) tierHits[hit]++;
        add(item);
      } else misses++;
    }
  }
  return { items: Array.from(totals, ([item, count]) => ({ item, count })), tierHits, misses };
}
