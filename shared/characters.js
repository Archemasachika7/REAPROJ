// Character roster (pure data, shared so the server can validate selections).
// hat: cap | capBack | beanie | bucket | hood | none
// hair: none | short | spiky | ponytail | bob
// extra: none | headphones | shades | scarf
export const CHARACTERS = [
  { id: 0, name: 'NOVA', skin: 0xd9a066, top: 0x00bcd4, sleeve: 0x0097a7, pants: 0x232a3b, shoes: 0xf5f5f5, hat: 'capBack', hatColor: 0xffffff, hair: 'short', hairColor: 0x2b1b12, extra: 'none', pack: 0xff3d9a },
  { id: 1, name: 'REX', skin: 0x7a4a2b, top: 0xff7a1a, sleeve: 0xe05a00, pants: 0x3a5ba0, shoes: 0xffd93d, hat: 'beanie', hatColor: 0x22252e, hair: 'none', hairColor: 0x000000, extra: 'scarf', pack: 0x222222 },
  { id: 2, name: 'KIKO', skin: 0xf5d3b3, top: 0xff4d8d, sleeve: 0xd93674, pants: 0x4a4f5c, shoes: 0x7cf2ff, hat: 'none', hatColor: 0, hair: 'spiky', hairColor: 0x15151c, extra: 'headphones', pack: 0x00e5ff },
  { id: 3, name: 'MIRA', skin: 0xc68642, top: 0xa56bff, sleeve: 0x8250e0, pants: 0x1f8a8a, shoes: 0xff5c8a, hat: 'none', hatColor: 0, hair: 'ponytail', hairColor: 0x3a1c0e, extra: 'shades', pack: 0xffd24a },
  { id: 4, name: 'ZED', skin: 0xeadbc8, top: 0x4caf50, sleeve: 0x388e3c, pants: 0x14161d, shoes: 0xe53935, hat: 'hood', hatColor: 0x2e7d32, hair: 'none', hairColor: 0x000000, extra: 'none', pack: 0x9dff4d },
  { id: 5, name: 'JUNO', skin: 0x5c3a21, top: 0xffd400, sleeve: 0xe6b800, pants: 0x1b2a55, shoes: 0x2b2b2b, hat: 'bucket', hatColor: 0xffd400, hair: 'bob', hairColor: 0x120a06, extra: 'none', pack: 0xff7a1a },
];
export const POLICE = { id: -1, name: 'POLICE', skin: 0xd9a066, top: 0x5aa0e0, sleeve: 0x5aa0e0, pants: 0x1a2340, shoes: 0x0e0e12, hat: 'cap', hatColor: 0x1a2340, hair: 'none', hairColor: 0, extra: 'none', pack: 0x1a2340 };
export const CHARACTER_COUNT = CHARACTERS.length;
export const validCharacter = (n) => Number.isInteger(n) && n >= 0 && n < CHARACTER_COUNT;
