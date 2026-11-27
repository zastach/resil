// RustClash Metal Armor Insert (Armor tab) and Rust Wiki's clothing compatibility list.
const maxSlots = new Map<string, number>([
  ...[
    'deer.skull.mask',
    'coffeecan.helmet',
    'metal.facemask',
    'metal.facemask.hockey',
    'metal.facemask.icemask',
    'knightsarmour.helmet',
  ].map((item) => [item, 1] as const),
  ...[
    'ballistic.legarmor',
    'ballistic.vest',
    'bone.armor.suit',
    'bucket.helmet',
    'cocoknight.armor.pants',
    'cocoknight.armor.torso',
    'attire.hide.poncho',
    'jacket',
    'knighttorso.armour',
    'knightsarmour.skirt',
    'metal.plate.torso',
    'metal.plate.torso.icevest',
    'riot.helmet',
    'roadsign.jacket',
    'roadsign.kilt',
    'wood.armor.jacket',
    'wood.armor.pants',
    'hazmatsuit',
    'hazmatsuit.arcticsuit',
    'hazmatsuit.diver',
    'hazmatsuit.frontier',
    'hazmatsuit.kick',
    'hazmat.krieg',
    'hazmatsuit.lumberjack',
    'hazmatsuit.nomadsuit',
    'hazmatsuit.pilot',
    'hazmat.plague',
    'hazmatsuit.spacesuit',
  ].map((item) => [item, 3] as const),
]);

export function armorSlotMaximum(item: string) {
  return maxSlots.get(item) ?? 0;
}

export function pickArmorSlots(chances: number[], roll: number) {
  for (let slot = chances.length; slot > 0; slot--) {
    roll -= chances[slot - 1];
    if (roll < 0) return slot;
  }
  return 0;
}
