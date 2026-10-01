# Asset Credits & Motion Research Documentation

This document records the motion asset research, candidate evaluations, page-level licensing verification, and the motion strategy implemented for the **Bầu Cua Victory** Game Hub.

## 1. Candidate Motion Assets Researched (Lottie / Vector)

| Candidate Asset | Source URL | Page-Level License & Size | Evaluation & Technical Decision |
| :--- | :--- | :--- | :--- |
| **Dragon Animation** | [LottieFiles - Dragon](https://lottiefiles.com/free-animation/dragon-MQKdsTwtAl) | [Lottie Simple License](https://lottiefiles.com/page/license) (26.7 KB optimized dotLottie) | Evaluated for Chơi Nhanh card. Style is a modern stylized vector mascot that diverges from the Vietnamese imperial festival lacquer aesthetic established across the arena. Kept as reference; rejected in favor of project-generated original artwork with CSS motion to maintain art cohesion without adding external dotLottie runtime player dependencies. |
| **Lion Dance Animation** | [LottieFiles - Lunar New Year Lion Dance](https://lottiefiles.com/free-animation/lunar-new-year-lion-dance-QPzH27qlxL) | [Lottie Simple License](https://lottiefiles.com/page/license) (10.8 KB) | Evaluated for Bạn Bè card. Depicts a single cartoon lion character. Does not match the dual festive southern lion dance pair and luxury casino gold palette of the project. Rejected to avoid third-party runtime player dependencies and style clash. |
| **Phoenix Animation** | [LottieFiles - Phoenix](https://lottiefiles.com/free-animation/phoenix-DiowHl2M67) | [Lottie Simple License](https://lottiefiles.com/page/license) (216.1 KB optimized dotLottie) | Evaluated for Game Khác card. While dynamic, the payload (216 KB + player engine) is significantly heavier than pure CSS transforms, and its neon fantasy visual style conflicts with the imperial red/gold theme. |

### Licensing Context
- **Lottie Simple License** (`https://lottiefiles.com/page/license`): Grants a worldwide, non-exclusive, royalty-free license to use, download, modify, and distribute the animation in commercial and non-commercial products without attribution, subject to standard non-resale/redistribution as standalone stock restrictions.

## 2. Motion Implementation Strategy

As specified in the design guidelines (*"If no excellent licensed asset is found, keep the original artwork and create motion with CSS transforms, parallax, particles, light sweeps, and layered effects"*):

1. **Dragon Card (Chơi Nhanh)**:
   - The lobby serves the native animated WebP `quick-play-dragon-motion-v3.webp` (576 pixels wide) or its 480-pixel mobile variant. The original 2.5× playback speed is baked into the image loop.
   - User-provided dragon texture; built-in ImageGen cleanup used only for the water and outer edge repair.
   - Fixed camera, regional whisker/mane/lantern motion, eye light, smoke, outward water surges, metallic glints, and overhead lightning.
   - Swaps to a matching still while the lobby or page is hidden. The user explicitly requests card motion on desktop and phone, so the card's force-motion flag preserves it. The rendered source MP4 is preserved locally in `media-sources/hub/`; the obsolete composition, QA and snapshots have been removed.
2. **Chơi Với Bạn Card**:
   - Keeps the user-provided `media-sources/hub/baucua.mp4` as the local source. All three friends loops have 1.5× speed baked in, shortening the loop to approximately 3.5 seconds without raising the mobile decoding frame rate. Desktop retains the sharp 640-pixel-wide, quality-84 WebP `baucua-motion-v5.webp` at 12 fps.
   - Phones prefer `baucua-mobile-v5.mp4`: silent H.264 Constrained Baseline, 384 × 514, 24 fps, fast-start metadata, approximately 344 KB. Only this card uses video; the other cards retain native image loops.
   - Unsupported video, denied autoplay or stalled playback switches to `baucua-motion-mobile-v5.webp`, a 320-pixel-wide, 24-fps quality-68 image loop. The fallback is not requested during successful mobile video playback. Touch retries playback.
   - `baucua-poster-v3.webp` is a matching source frame for loading and fallback.
   - Playback pauses while the lobby or page is hidden and resumes on return. Desktop image animation restores the poster while hidden.
   - The former lion video, poster, dedicated CSS animation, and `videos/red-lion/` authoring project have been removed.
3. **Table Card (Chọn Bàn)**:
   - Serves `choose-table-lion-motion-v3.webp`, a native animated 480 × 646 WebP, with a matching still poster.
   - The user-provided `media-sources/hub/choose-table-lion.mp4` is preserved as the local source.
4. **Phoenix Card (Game Khác)**:
   - Majestic wing breathing and fiery glow sweep (`hub-phoenix-wings`, `hub-phoenix-flare`).
   - Radial sun pulse accentuating the vermilion phoenix plumage.
   - All four card labels share the quick-play gold sheen, floating wordmark, and glowing subtitle. CSS animation state follows the lobby/page lifecycle instead of intersection callbacks on the scaled arcade viewport.
   - Only the title and subtitle float. Their background scrim stays fixed and the gold frame sits above it, preventing stray gold lines along the bottom during animation.
   - The global arena reduced-motion rule excludes descendants of explicitly force-enabled lobby cards. This prevents desktop reduced-motion settings from shrinking their animations to 0.01 ms and one iteration; other UI retains its reduced-motion behavior.
5. **Background & Atmosphere**:
   - Parallax background subtle drift (`hub-bg-drift`).
   - Header logo gold shimmer sweep (`hub-logo-shimmer`).
   - Interactive canvas particle fireworks and golden dust that automatically pauses on `document.hidden` and respects `prefers-reduced-motion: reduce`.

## 3. Local Project Artwork Manifest

| Local Asset Path | Description | Provenance / Attribution |
| :--- | :--- | :--- |
| `public/assets/hub/hub-background.jpg` | Traditional Vietnamese festival palace interior | Project-generated original artwork |
| `media-sources/hub/*.mp4` | Three original source videos; local only, excluded from Git and Docker | Original rendered dragon and user-provided Bầu Cua/table videos |
| `public/assets/hub/*-motion*-v3.webp` | Native animated card loops; infinite repeat; 12 fps; larger desktop and smaller mobile variants | Local FFmpeg derivatives of the original source videos |
| `public/assets/hub/baucua-motion-v5.webp` | Sharp desktop friends loop at 1.5× speed, 640 pixels wide, 12 fps | Local FFmpeg derivative of user-provided Bầu Cua video |
| `public/assets/hub/baucua-mobile-v5.mp4` | Lightweight 24-fps mobile friends loop, silent H.264 with fast-start metadata | Local FFmpeg derivative of user-provided Bầu Cua video |
| `public/assets/hub/baucua-motion-mobile-v5.webp` | 24-fps mobile friends fallback, loaded only when video cannot play | Local FFmpeg derivative of user-provided Bầu Cua video |
| `public/assets/hub/*-poster-v3.webp` | Current loading/fallback posters | Frames extracted directly from source videos |
| `public/assets/hub/other-games-phoenix-v1.jpg` | Vermilion fire phoenix rising | Project-generated original artwork |
| `public/assets/arena/logo1.png` | Bầu Cua Victory brand mark | Project asset |
| `public/assets/arena/backgroud.png` | Current game-stage background and blurred outer fill | User-provided project artwork |
| `public/assets/arena/*.png` | Gourd, Crab, Fish, Shrimp, Rooster, Deer symbols & dice faces | Project assets |

Regenerate current lobby motion with `node scripts/build-hub-motion.js` (uses the bundled FFmpeg, `FFMPEG_PATH`, or FFmpeg on PATH). Use `--friend-only` to rebuild only the friends card video, image loops and poster. Put the original MP4 files in `media-sources/hub/` or set `HUB_MOTION_SOURCE_DIR`. Normal application builds use the committed WebP files and the one mobile MP4. Larger images preserve desktop detail; the friends card uses a smaller video on phones. Obsolete derivatives, posters, playback code and rendering projects have been removed.
