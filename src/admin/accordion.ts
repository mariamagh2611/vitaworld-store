// Preserve the header's position, including a collapse initiated at the bottom
// of a long offer. Browser scroll anchoring must not send the merchant elsewhere.
export function keepAccordionHeader(details: HTMLDetailsElement | null, change: () => void) {
  const summary = details?.querySelector<HTMLElement>(':scope > summary');
  const toolbar = document.querySelector<HTMLElement>('.product-editor-toolbar');
  const safeTop = Math.max(12, (toolbar?.getBoundingClientRect().bottom || 0) + 12);
  const before = summary?.getBoundingClientRect().top;
  const target =
    before === undefined ? safeTop : Math.max(safeTop, Math.min(before, innerHeight - 100));
  change();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!summary?.isConnected) return;
      window.scrollBy({ top: summary.getBoundingClientRect().top - target, behavior: 'instant' });
      summary.focus({ preventScroll: true });
    }),
  );
}
