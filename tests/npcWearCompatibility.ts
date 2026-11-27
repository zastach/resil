import assert from 'node:assert/strict';
import { test } from 'node:test';
import { haveWearConflict } from '../src/client/pages/devtools/wear-compatibility';
import catalog from '../src/client/pages/devtools/rust-wearables.json';

test('Rust wear coverage distinguishes face, hat, base clothing and outer armor', () => {
  for (const [first, second] of [
    ['hat.cap', 'mask.bandana'],
    ['jacket', 'shirt.collared'],
    ['roadsign.kilt', 'pants'],
    ['hazmatsuit', 'largebackpack'],
  ])
    assert.equal(haveWearConflict(first, second), false, first + ' / ' + second);

  for (const item of catalog) assert.equal(haveWearConflict('gloweyes', item.shortname), false);
  for (const [first, second] of [
    ['hat.cap', 'hat.beenie'],
    ['jacket', 'metal.plate.torso'],
    ['tshirt', 'shirt.collared'],
    ['diving.tank', 'largebackpack'],
    ['hazmatsuit', 'burlap.gloves'],
  ]) {
    assert.equal(haveWearConflict(first, second), true, first + ' / ' + second);
    assert.equal(haveWearConflict(second, first), true);
  }
});

test('backpacks use the dedicated picker and the bandana has its player-facing name', () => {
  for (const id of ['largebackpack', 'smallbackpack', 'kriegbackpack'])
    assert.deepEqual(catalog.find((item) => item.shortname === id)?.slots, ['Backpack']);
  assert.equal(catalog.find((item) => item.shortname === 'mask.bandana')?.name, 'Bandana');
});

test('Alien Costume uses Chicken Costume coverage with room for a hat and top', () => {
  assert.equal(haveWearConflict('alien.costume', 'hat.cap'), false);
  assert.equal(haveWearConflict('alien.costume', 'shirt.collared'), false);
  assert.equal(haveWearConflict('alien.costume', 'roadsign.kilt'), true);
  for (const { shortname } of catalog)
    assert.equal(
      haveWearConflict('alien.costume', shortname),
      haveWearConflict('chicken.costume', shortname),
      shortname,
    );
});
