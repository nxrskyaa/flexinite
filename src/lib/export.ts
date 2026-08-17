"use client";

export async function exportCard(node: HTMLElement, filename: string): Promise<string> {
  const { toPng } = await import("html-to-image");
  const url = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    filter: (el) => !(el instanceof HTMLElement && el.hasAttribute("data-no-export")),
  });
  void filename;
  return url;
}
