export const rustSignGroups = [
  {
    name: 'Picture and photo frames',
    sizes: [
      ['XXL Picture Frame', 1024, 512],
      ['XL Picture Frame', 512, 512],
      ['Tall Picture Frame', 128, 512],
      ['Landscape Picture Frame', 256, 192],
      ['Portrait Picture Frame', 205, 256],
      ['Large or Landscape Photo Frame', 320, 240],
      ['Portrait Photo Frame', 320, 384],
    ],
  },
  {
    name: 'Artist canvases',
    sizes: [
      ['Artist Canvas XXL', 1024, 512],
      ['Artist Canvas XL', 512, 512],
      ['Artist Canvas Large', 320, 240],
      ['Artist Canvas Standing', 256, 640],
      ['Artist Canvas Small', 192, 256],
    ],
  },
  {
    name: 'Wooden signs and posts',
    sizes: [
      ['Huge Wooden Sign', 1024, 256],
      ['Large or Medium Wooden Sign', 512, 256],
      ['Small Wooden Sign', 256, 128],
      ['One- or Two-Sided Town Sign', 512, 256],
      ['Single Sign Post', 256, 128],
      ['Double Sign Post', 512, 512],
      ['Two-Sided Hanging Sign', 256, 512],
      ['Two-Sided Ornate Hanging Sign', 512, 256],
    ],
  },
  {
    name: 'Neon, banners, and other paintables',
    sizes: [
      ['Large Neon Sign', 256, 256],
      ['Medium Neon Sign', 256, 128],
      ['Small Neon Sign', 128, 128],
      ['Large Hanging Banner or Banner on Pole', 256, 1024],
      ['Carving Pumpkin', 256, 256],
      ['Spinny Sign', 512, 512],
    ],
  },
] as const;
