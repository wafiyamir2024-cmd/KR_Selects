# KR Character Select

A responsive character selector for Player 1, with a continuous hexagon roster, full-body previews, search, series filters, keyboard navigation, and spoken character names. A separate **Rider Lineup** tab displays the full-body cast together.

## Run

Requires Node.js 18 or newer. There are no dependencies to install.

```sh
npm start
```

Open **http://127.0.0.1:2022**. You can also run `node server.mjs` directly. Run the data and server checks with `npm test`.

## Add characters

Place artwork in `images/` and add records to `data.json`. Reload the page after editing. There is no fixed roster limit: all characters appear in one scrollable grid, with search and series filters to help you find a rider.

```json
[
  {
    "No": 0,
    "Sub No": 0,
    "Series": "Main Kamen Rider",
    "Characters": [
      {
        "Name": "ZX",
        "Image": "zx.png",
        "Order": 10,
        "P": "Zet Cross",
        "Size": 3
      }
    ]
  }
]
```

Characters sort numerically by **No → Sub No → Order**. Numeric strings also work. Equal values retain their source order, and missing or invalid numbers sort last.

`Image` supplies the full-body artwork. The hexagon crops that image to the face. You can optionally provide `Portrait` with a separate headshot filename from `images/`; a headshot uses a centered cover crop. `Portrait Image` is also accepted.

For full-body images, optional `FaceX`, `FaceY`, and `FaceZoom` fields tune the hexagon crop. Defaults are `50`, `12`, and `2.6`: a face near the top center, with image width at 2.6 times the tile width. `FaceX` and `FaceY` are percentages locating the face within the source image. Larger `FaceZoom` values zoom in further. These settings only affect the roster portrait.

`P` optionally supplies the spoken name in both tabs. For example, `"Name": "ZX", "P": "Zet Cross"` displays **ZX** and announces **Zet Cross**. If `P` is missing, null, or blank, speech uses `Name` directly. The older `VoiceName` field is no longer used. Name announcements use the browser's speech synthesis voices. Audio begins after a user interaction and depends on available system voices.

Give each record its own artwork filename to display distinct characters.

## Controls

- Hover or click a hexagon to preview a rider. Click **Confirm rider** to lock in Player 1 on the same page. Click **Change rider**, press **Escape**, or click another hexagon to change the selection.
- Use the arrow keys to navigate, **Home/End** to jump to the first or last rider, and **Page Up/Down** to move through the continuous grid. Press **Enter** to confirm, **R** for a random rider, and **/** to search.
- Sound and fullscreen controls are in the top right.
- **Random** chooses from the current search/series results.

The roster keeps every matching character in one continuous grid, with **30 characters per row** and a partial final row. All 30 columns fit the available width on desktop and mobile, and the roster scrolls vertically only. Filters with fewer than 30 matches use only the occupied columns. Hexagons shrink on smaller screens to keep the whole row visible. Portrait images load lazily as you approach them, and keyboard navigation and random selection bring the selected rider into view. The included checks exercise a continuous roster of 650 records. Missing artwork gets a fallback, and reduced-motion preferences are respected.

## Rider Lineup

Open the **Rider Lineup** tab, or visit **http://127.0.0.1:2022/#lineup** directly, to see the characters' full-body `Image` artwork arranged as a crowd. Hover over a rider to see their name.

In the lineup and its PNG download, characters whose `Image` is `NoName.png` use `images/NoName 2.png` with their `Name` printed on the torso. Labels wrap and scale with the artwork. This substitution does not change `data.json` or Character Select.

Click **Download PNG** to save the complete lineup, including rows outside the visible area, with the same character sizes and ordering. The export has a dark background and aims for 3840 pixels wide, reducing resolution for very large lineups or browser limits. Missing artwork uses initials. Exporting keeps your current selection and scroll position.

Each character can have an optional `Size` multiplier that applies only to their full-body artwork in **Rider Lineup**. `"Size": 3` makes that rider three times their normal lineup width and height; `0.5` makes them half-size. Positive finite numbers and numeric strings such as `"3"` are accepted. Missing, blank, invalid, zero, or negative values use the normal size of `1`.

The lineup follows **No → Sub No → Order**, reading left to right within each row and **from the bottom row upward**. Every character with both `No: 0` and `Sub No: 0` appears together in the bottom row. This row is exclusive to that group and has no character limit. All remaining characters fill rows above it, with a maximum of **40 characters per row**. If the data has no characters in the `0 / 0` group, the first normal row becomes the bottom row; no empty row is added.

The **Character Select** tab retains its single-player selection and 30-column hexagon roster. Lineup checks cover numeric ordering, an unlimited bottom row, missing bottom-group data, and all 650 records appearing exactly once.

Optional visual checks are in `scripts/check-browser.cjs`, `scripts/check-lineup.cjs`, `scripts/check-character-options.cjs`, and `scripts/preview.cjs`. They require Playwright to be available to Node and an installed Chrome (set `CHROME_PATH` for a different location). These tools save screenshots under `artifacts/`; the app itself has no package dependencies.

`scripts/check-lineup-export.cjs` checks the browser download and PNG contents with Playwright and Sharp. `scripts/check-lineup-export-native.cjs` checks the same renderer with `@napi-rs/canvas` and Sharp, including complete 650-rider output, size multipliers, missing artwork, and larger rosters.
"# KR_Selects" 
