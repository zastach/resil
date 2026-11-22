-- Legacy multipart uploads inserted each pair in the same transaction, sharing createdAt.
-- Use that timestamp and the exact generated filename to avoid linking later lookalikes.
WITH presets(suffix, label) AS (
  VALUES
    ('xxl-picture-frame', 'XXL Picture Frame'),
    ('xl-picture-frame', 'XL Picture Frame'),
    ('tall-picture-frame', 'Tall Picture Frame'),
    ('landscape-picture-frame', 'Landscape Picture Frame'),
    ('portrait-picture-frame', 'Portrait Picture Frame'),
    ('large-or-landscape-photo-frame', 'Large or Landscape Photo Frame'),
    ('portrait-photo-frame', 'Portrait Photo Frame'),
    ('artist-canvas-xxl', 'Artist Canvas XXL'),
    ('artist-canvas-xl', 'Artist Canvas XL'),
    ('artist-canvas-large', 'Artist Canvas Large'),
    ('artist-canvas-standing', 'Artist Canvas Standing'),
    ('artist-canvas-small', 'Artist Canvas Small'),
    ('huge-wooden-sign', 'Huge Wooden Sign'),
    ('large-or-medium-wooden-sign', 'Large or Medium Wooden Sign'),
    ('small-wooden-sign', 'Small Wooden Sign'),
    ('one-or-two-sided-town-sign', 'One- or Two-Sided Town Sign'),
    ('single-sign-post', 'Single Sign Post'),
    ('double-sign-post', 'Double Sign Post'),
    ('two-sided-hanging-sign', 'Two-Sided Hanging Sign'),
    ('two-sided-ornate-hanging-sign', 'Two-Sided Ornate Hanging Sign'),
    ('large-neon-sign', 'Large Neon Sign'),
    ('medium-neon-sign', 'Medium Neon Sign'),
    ('medium-animated-neon-sign', 'Medium Animated Neon Sign'),
    ('large-animated-neon-sign', 'Large Animated Neon Sign'),
    ('small-neon-sign', 'Small Neon Sign'),
    ('large-hanging-banner-or-banner-on-pole', 'Large Hanging Banner or Banner on Pole'),
    ('carving-pumpkin', 'Carving Pumpkin'),
    ('spinny-sign', 'Spinny Sign'),
    ('paintable-reactive-target', 'Paintable Reactive Target'),
    ('paintable-window', 'Paintable Window'),
    ('small-light-up-frame', 'Small Light-up Frame'),
    ('large-light-up-frame', 'Large Light-up Frame'),
    ('standing-light-up-frame', 'Standing Light-up Frame'),
    ('xl-light-up-frame', 'XL Light-up Frame'),
    ('xxl-light-up-frame', 'XXL Light-up Frame'),
    ('small-gold-frame', 'Small Gold Frame'),
    ('large-gold-frame', 'Large Gold Frame'),
    ('standing-gold-frame', 'Standing Gold Frame'),
    ('xl-gold-frame', 'XL Gold Frame'),
    ('xxl-gold-frame', 'XXL Gold Frame'),
    ('small-scrap-frame', 'Small Scrap Frame'),
    ('large-scrap-frame', 'Large Scrap Frame'),
    ('standing-scrap-frame', 'Standing Scrap Frame'),
    ('xl-scrap-frame', 'XL Scrap Frame'),
    ('xxl-scrap-frame', 'XXL Scrap Frame')
), candidates AS (
  SELECT child.id AS child_id, parent.id AS parent_id, parent."originalName" AS source_name,
    parent.organization AS parent_organization, presets.label,
    count(*) OVER (PARTITION BY child.id) AS matches
  FROM "File" AS child
  JOIN "File" AS parent ON parent."userId" = child."userId"
    AND parent."createdAt" = child."createdAt"
    AND parent."folderId" IS NOT DISTINCT FROM child."folderId"
    AND parent.id <> child.id
  JOIN presets ON child."originalName" IN (
    regexp_replace(parent."originalName", '\.[^.]+$', '') || '-' || presets.suffix || '.jpeg',
    regexp_replace(parent."originalName", '\.[^.]+$', '') || '-' || presets.suffix || '.png'
  )
  WHERE child.organization IS NULL
    AND child.type IN ('image/png', 'image/jpeg')
    AND parent.type LIKE 'image/%'
    AND parent.organization->>'variant' IS NULL
), pairs AS (
  SELECT * FROM candidates AS candidate
  WHERE matches = 1
    AND NOT EXISTS (SELECT 1 FROM candidates WHERE child_id = candidate.parent_id)
)
UPDATE "File" AS child
SET organization = jsonb_build_object(
  'groupId', coalesce(pairs.parent_organization->>'groupId', pairs.parent_id),
  'displayName', coalesce(
    pairs.parent_organization->>'displayName',
    nullif(left(trim(regexp_replace(regexp_replace(pairs.source_name, '\.[^.]+$', ''), '[_[:space:]-]+', ' ', 'g')), 120), ''),
    'Untitled image'
  ),
  'sourceName', left(pairs.source_name, 512),
  'variant', pairs.label
)
FROM pairs
WHERE child.id = pairs.child_id;
