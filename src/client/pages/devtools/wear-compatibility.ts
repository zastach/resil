import catalog from './rust-wearables.json';

// Source: ItemModWearable OccupationOver and OccupationUnder from rustdocs.com/items/<shortname>.
// Each key is a Rust wearable layer and body region, such as "over:TorsoFront".
// Missing coverage means the editor has no verified overlap for that item.
const coverage = new Map<string, readonly string[]>(
  catalog.map((item) => [item.shortname, item.coverage ?? []]),
);

export function haveWearConflict(first: string, second: string) {
  const other = coverage.get(second);
  return !!other && !!coverage.get(first)?.some((region) => other.includes(region));
}
