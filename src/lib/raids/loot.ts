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
export const lootSchema = z.object({
  Name: z.string().trim().min(1).max(80),
  Rolls: z.number().int().min(0).max(200),
  Entries: z.array(entry).min(1).max(200),
  Guaranteed: z.array(entry).max(200),
});
export type Loot = z.infer<typeof lootSchema>;
export const starter: Loot = {
  Name: 'Starter',
  Rolls: 2,
  Entries: [{ Item: 'scrap', Min: 10, Max: 25, Weight: 1 }],
  Guaranteed: [],
};

export function simulate(table: Loot, runs = 100) {
  const totals = new Map<string, number>();
  const totalWeight = table.Entries.reduce((n, e) => n + e.Weight, 0);
  function add(e: Loot['Entries'][number]) {
    totals.set(e.Item, (totals.get(e.Item) ?? 0) + e.Min + Math.floor(Math.random() * (e.Max - e.Min + 1)));
  }
  for (let i = 0; i < runs; i++) {
    table.Guaranteed.forEach(add);
    for (let j = 0; j < table.Rolls; j++) {
      let draw = Math.random() * totalWeight;
      const item =
        table.Entries.find((e) => (draw -= e.Weight) < 0) ?? table.Entries[table.Entries.length - 1];
      add(item);
    }
  }
  return Array.from(totals, ([item, count]) => ({ item, count }));
}
