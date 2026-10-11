# Visual assets: inventory and provenance

All images live in `frontend/assets/images/`. Nothing is loaded from a remote image host.

## From the zero-waste presentation (cut-paper illustrations and textures)
Extracted from `Green_and_Brown_Illustrated_Zero_Waste_Presentation.pptx` (ppt/media), resized and converted to WebP with transparency kept.

| File | Source | Used in |
|---|---|---|
| forest-paper-texture.jpg | image1.jpeg, darkened toward #123B2A | Hero, impact band, page banners, footer |
| cream-paper-sheet.webp | image12.png | Hero collage |
| kraft-paper-tear.webp | image3.png | Job card tape, paper panels, footer edge, hero, final CTA |
| kraft-grass-paper.webp | image13.png | ReLife collage |
| leaf-illustration, leaf-basil, leaf-branch, leaf-pair, leaf-fern (.webp) | image2, 10, 29, 42, 18 | Hero, final CTA, owner page, page corner accent |
| hand-seedling.webp | image11.png | Recover stage, empty states |
| recycle-symbol, recycle-arrows (.webp) | image14, image38 | Journey nodes, recovery collage |
| bulb-sprout, bulb-glass, seedling-bulb (.webp) | image15, image40, image8 | Journey nodes, ReLife collage |
| eco-tag.webp | image27.png | Hero, journey node |
| recycle-bin-illustration.webp, hand-plant.webp | image5, image24 | Available for empty states |
| tree-collage.webp | image44.png | Ratings page banner |

## Treated e-waste photographs (from the WhatsApp images)
Not used raw. Each was colour-graded toward the forest/cream palette, given film grain, and cut with torn cream-paper edges.

| File | Source | Treatment | Used in |
|---|---|---|---|
| ewaste-circuit-boards.jpg / -torn.webp | Gloved hands holding circuit boards | 38% forest-cream tone blend, grain, torn paper frame | Landing hero |
| ewaste-collection-bin.jpg / -torn.webp | Green bin full of electronics | 30% tone blend, grain, torn paper frame | Recovery collage |
| circuit-duotone.jpg | Same circuit-board photo | Full forest/leaf duotone, grain | Impact band background (16%, screen blend) |

Not used: the "Beyond Reduce, Reuse, Recycle" title slide (someone else's presentation with their name and text), and the "E-waste recycling process" infographic (someone else's illustration). The six-step "How it works" section takes inspiration from the infographic's structure, but its illustrations are original.

## Generated for this project
- **collage-recovery.webp** and **collage-relife.webp**: composites of the treated photos and the deck's cut-outs, made with a script. Used in the problem section, the Recycle journey stage, and the ReLife banner.
- **Six cut-paper SVG illustrations** in `frontend/js/illustrations.js` (identify, diagnose, reuse, recover, deliver, insights), drawn in the deck's palette with a rough-edge filter.
- **Logo mark**: an inline SVG (a leaf inside a circular arrow).
- **Paper grain**: an inline SVG noise filter. No raster texture.

## Rights check before publishing
- **Deck artwork:** the presentation looks like a design-platform template. Its artwork is usually licensed for use within that platform's terms. Confirm that your licence covers use on a public website.
- **Photographs:** the e-waste photos came from web searches. Confirm their licences, or swap in your own photos of a local repair shop. Your own photos would also be more authentic.
