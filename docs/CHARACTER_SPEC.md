# DREAM SURFERS — Character Spec (realistic, supplied GLBs)

Status: design only. No loader code is written until this is approved.
Direction: realistic, PBR-textured humans in the style of modern PC games, delivered as rigged `.glb` files.

## 1. Roster

Six runners, one police officer. Every runner shares one skeleton, so any animation plays on any character.

| # | Codename | Body | Look | Gun colour accent |
|---|----------|------|------|-------------------|
| 0 | NOVA  | female, athletic | cyan technical jacket, black leggings, white sneakers, backwards cap | cyan |
| 1 | REX   | male, broad | orange bomber, worn jeans, beanie, scarf | orange |
| 2 | KIKO  | male, lean | magenta hoodie, grey cargo pants, over-ear headphones, spiky hair | magenta |
| 3 | MIRA  | female, lean | purple windbreaker, teal pants, ponytail, sunglasses | gold |
| 4 | ZED   | male, average | green hooded jacket (hood up), black pants, red sneakers | lime |
| 5 | JUNO  | female, average | yellow rain jacket, navy pants, bucket hat | orange |
| P | POLICE | male, average | navy uniform, light-blue shirt, duty belt, cap with badge | none |

Skin tones must vary across the roster (at least three distinct tones). Faces should be real-looking but not portraits of real people.

## 2. Technical requirements per character

| Item | Requirement |
|------|-------------|
| Format | glTF Binary (`.glb`), one file per character |
| Triangles | 15k–40k body+clothes, max 45k with hair |
| Skeleton | Mixamo-compatible humanoid (`mixamorig:Hips` … `mixamorig:RightToe_End`), about 65 bones, same rig on every character |
| Height | 1.75 m (1 unit = 1 m), origin at the feet, facing **+Z** (the loader will rotate to the game's -Z) |
| Pose | T-pose or A-pose bind pose |
| Materials | at most 4 per character: skin, clothes, hair, accessories (merge small ones) |
| Textures | PBR metal-rough. 2048² for body/clothes, 1024² for hair/accessories. Albedo (sRGB), normal, ORM packed (occlusion/roughness/metal) |
| Weights | max 4 influences per vertex, no unskinned floating meshes |
| Budget | at most 6 MB per character after compression (see §6) |

## 3. Animation list

Delivered either baked into each character GLB, or as one shared `animations.glb` (preferred, so characters stay small). Clip names are exact and case-sensitive.

| Clip name | Loop | Use | Notes |
|-----------|------|-----|-------|
| `Idle` | yes | countdown, menu, finished | relaxed breathing, weight shift |
| `Run` | yes | main gameplay | sprint, forward lean, about 0.7 s per cycle, in place (no root motion) |
| `RunArmed` | yes | running while holding the gun | gun hand up, other arm pumping |
| `JumpStart` | no | take-off | about 0.2 s |
| `JumpAir` | yes | airborne | stride-leap pose |
| `JumpLand` | no | landing | about 0.25 s, blends to `Run` |
| `Slide` | no | duck under overhead barrier | about 0.6 s, low profile (replaces the somersault) |
| `Stumble` | no | hit an obstacle | about 1.2 s, off-balance recovery back into run |
| `StrafeLeft` / `StrafeRight` | no | lane change | about 0.25 s, shoulder lean |
| `ShootBack` | no | solo mode: turn and fire at police | about 0.3 s, one-handed pistol, running |
| `AimIdle` | yes | arena: stationary with pistol raised | two-handed |
| `AimRunF` / `AimRunB` / `AimRunL` / `AimRunR` | yes | arena: strafe-run while aiming | 4 directions, so legs follow movement while the torso follows the mouse |
| `Fire` | no | arena: additive recoil | additive layer, about 0.15 s |
| `HitReact` | no | arena: take damage | about 0.4 s |
| `Death` | no | busted / eliminated | about 1.5 s, ends lying down and holds the last frame |
| `Victory` | no | winner screen | about 2 s |
| `Defeat` | no | loser screen (survivor who was out-scored) | about 2 s |

The police officer additionally needs `Run` (slightly slower, heavier) and `Idle`. They reuse the runner clips when the rigs match.

## 4. Props

| Prop | Spec |
|------|------|
| Pistol | separate `pistol.glb`, under 3k tris, PBR, origin at the grip, muzzle along -Z. Attached to `mixamorig:RightHand`. Muzzle flash is made in code. |
| Police badge, cap | part of the officer model |

## 5. Files and naming

```
public/assets/characters/
  nova.glb  rex.glb  kiko.glb  mira.glb  zed.glb  juno.glb  police.glb
  animations.glb          # shared clips (or clips baked in each file)
public/assets/props/
  pistol.glb
public/assets/characters/credits.md   # source + licence for every file
```

Each character GLB must include a single skinned mesh node and the armature. The loader reads all of this from the files, so `shared/characters.js` only keeps names, file paths and the gameplay-relevant metadata.

## 6. How the models get made (recommended path)

1. **Base bodies.** Produce one male and one female base mesh (MakeHuman CC0 output, Character Creator, Blender, or AI generation) and give them real clothing as separate meshes.
2. **Outfits.** Create the outfit variants above from those bases (texture and mesh swaps).
3. **Rig.** Upload each to Mixamo for auto-rig, or rig in Blender to the Mixamo bone naming, so animations retarget cleanly.
4. **Animations.** Pick or author the clips in §3. Export "FBX for Unity/with skin", then convert to GLB.
5. **Optimise.** Convert FBX to GLB, then compress:
   ```bash
   npx gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp
   ```
6. **Check.** Open each in https://gltf-viewer.donmccurdy.com/ and confirm that the bones are named as above, the height is 1.75 m, and every clip plays.

Licence notes (your responsibility, and I'll record them in `credits.md`):
- Mixamo content may be used in games and apps but not redistributed as standalone assets.
- AI-generated or purchased models need a licence that permits commercial or public web use.
- Don't model characters on real, identifiable people.

## 7. Game integration plan (built after assets are approved)

- Load each GLB with `GLTFLoader` and clone through `SkeletonUtils` so many instances can share one file.
- Animation state machine on `AnimationMixer`, with cross-fades of about 0.15 s: Idle, Run, JumpStart, JumpAir, JumpLand, Slide, Stumble, plus a Fire additive layer.
- Arena: lower body driven by movement direction (`AimRun*`), upper body aimed at the mouse by rotating the spine and chest bones.
- Pistol attached to the right hand and shown only when the player has ammo.
- Single mode: two police officers chase on foot, with `ShootBack` firing when the player shoots.
- Fallback: if a GLB fails to load, the current procedural characters stay as a safe fallback so the game never breaks.
- Loading: a progress screen, characters loaded on demand (selected runner first, others lazily for multiplayer ghosts).
- Quality settings: shadow and texture-resolution toggle for lower-end GPUs.

## 8. Acceptance checklist (per character)

- [ ] Opens in a glTF viewer with correct materials, no pink or black textures
- [ ] Height 1.75 m, feet at origin, bind pose symmetrical
- [ ] Bone names match the Mixamo rig exactly
- [ ] All clips in §3 present and named exactly
- [ ] At most 45k triangles, at most 6 MB compressed
- [ ] Source and licence recorded in `credits.md`
- [ ] Face, hands and shoes hold up when seen from 3 m behind and 9 m above (the two game cameras)

## 9. Open questions for you

1. Do you want the exact roster above, or different characters (more female/male, other outfits, a mascot)?
2. Should `Slide` replace the somersault roll? It reads more realistic.
3. Is a `Victory` / `Defeat` pose on the results screen wanted, or just text?
4. Any gore limits for arena eliminations? My default is a plain fall (`Death`) with no blood.
