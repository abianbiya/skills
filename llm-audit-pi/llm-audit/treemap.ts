/**
 * Context-window treemap: how the latest request's bytes are distributed across
 * categories, and within each category.
 *
 * Layout is a two-level band treemap rather than a squarified one: each category
 * gets a full-width band whose height is its share, and items inside a band are
 * laid out along the width by their share. That is trivially correct (no overlap
 * possible), deterministic, and it reads the way the question is asked — "which
 * category fills the window, and what fills that category".
 *
 * Rendered as inline SVG so the report stays script-free.
 */

export interface TreemapItem {
  label: string;
  bytes: number;
  group: string;
}

export interface TreemapTile extends TreemapItem {
  x: number;
  y: number;
  width: number;
  height: number;
  share: number;
}

export interface TreemapBand {
  group: string;
  bytes: number;
  share: number;
  y: number;
  height: number;
}

export interface TreemapLayout {
  width: number;
  height: number;
  tiles: TreemapTile[];
  bands: TreemapBand[];
  totalBytes: number;
}

const GROUP_ORDER = ["system", "tools", "history", "tool results", "other"];

/** Categories keep a stable, meaningful order rather than sorting by size. */
function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

export function layoutTreemap(
  items: TreemapItem[],
  width: number,
  height: number,
): TreemapLayout {
  const kept = items.filter((item) => item.bytes > 0);
  const totalBytes = kept.reduce((total, item) => total + item.bytes, 0);
  const bands: TreemapBand[] = [];
  const tiles: TreemapTile[] = [];
  if (totalBytes === 0) return { width, height, tiles, bands, totalBytes: 0 };

  const byGroup = new Map<string, TreemapItem[]>();
  for (const item of kept)
    byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
  const groups = [...byGroup.entries()].sort(
    (a, b) =>
      groupRank(a[0]) - groupRank(b[0]) ||
      b[1].reduce((sum, item) => sum + item.bytes, 0) -
        a[1].reduce((sum, item) => sum + item.bytes, 0),
  );

  let y = 0;
  for (const [group, group_items] of groups) {
    const groupBytes = group_items.reduce((sum, item) => sum + item.bytes, 0);
    const share = groupBytes / totalBytes;
    const bandHeight = share * height;
    bands.push({ group, bytes: groupBytes, share, y, height: bandHeight });
    let x = 0;
    for (const item of [...group_items].sort((a, b) => b.bytes - a.bytes)) {
      const itemShare = item.bytes / totalBytes;
      const tileWidth = (item.bytes / groupBytes) * width;
      tiles.push({
        ...item,
        x,
        y,
        width: tileWidth,
        height: bandHeight,
        share: itemShare,
      });
      x += tileWidth;
    }
    y += bandHeight;
  }
  return { width, height, tiles, bands, totalBytes };
}

const GROUP_COLOR: Record<string, string> = {
  system: "#6ea8fe",
  tools: "#f0b849",
  history: "#7ec699",
  "tool results": "#c792ea",
  other: "#8b93a7",
};

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ESCAPE[character] ?? character);

const formatBytes = (value: number): string =>
  value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MB`
    : value >= 1024
      ? `${(value / 1024).toFixed(1)} KB`
      : `${value} B`;

/**
 * Inline SVG treemap. Labels are only drawn where they fit, and every tile keeps
 * a native tooltip so small slices are still inspectable without a script.
 */
export function renderTreemapSvg(
  items: TreemapItem[],
  options: { width?: number; height?: number } = {},
): string {
  const width = options.width ?? 1080;
  const height = options.height ?? 320;
  const layout = layoutTreemap(items, width, height);
  if (layout.tiles.length === 0) return "";

  const tiles = layout.tiles
    .map((tile) => {
      const color = GROUP_COLOR[tile.group] ?? GROUP_COLOR.other!;
      const label = tile.label.length > 26 ? `${tile.label.slice(0, 25)}…` : tile.label;
      const showLabel = tile.width > 96 && tile.height > 26;
      const showDetail = tile.width > 96 && tile.height > 44;
      const centerX = tile.x + tile.width / 2;
      const centerY = tile.y + tile.height / 2;
      return `<g class="tile"><title>${escapeXml(`${tile.label} — ${formatBytes(tile.bytes)} (${(tile.share * 100).toFixed(1)}% of the window, ${tile.group})`)}</title>
<rect x="${tile.x.toFixed(2)}" y="${tile.y.toFixed(2)}" width="${Math.max(0, tile.width - 1.5).toFixed(2)}" height="${Math.max(0, tile.height - 1.5).toFixed(2)}" rx="3" fill="${color}" fill-opacity="0.82" stroke="var(--panel)" stroke-width="1" />
${
  showLabel
    ? `<text x="${centerX.toFixed(1)}" y="${(centerY - (showDetail ? 7 : 0) + 4).toFixed(1)}" text-anchor="middle" class="tile-label">${escapeXml(label)}</text>`
    : ""
}
${
  showDetail
    ? `<text x="${centerX.toFixed(1)}" y="${(centerY + 10).toFixed(1)}" text-anchor="middle" class="tile-detail">${escapeXml(`${formatBytes(tile.bytes)} · ${(tile.share * 100).toFixed(1)}%`)}</text>`
    : ""
}
</g>`;
    })
    .join("\n");

  const legend = layout.bands
    .map(
      (band) =>
        `<span class="legend-item"><span class="swatch" style="background:${GROUP_COLOR[band.group] ?? GROUP_COLOR.other!}"></span>${escapeXml(band.group)} ${(band.share * 100).toFixed(1)}% · ${formatBytes(band.bytes)}</span>`,
    )
    .join(" ");

  return `<figure class="treemap">
<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Context window by category">
${tiles}
</svg>
<figcaption><span class="legend">${legend}</span></figcaption>
</figure>`;
}
