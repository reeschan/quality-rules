declare function render(value: string, mode: 'compact' | 'full'): string;
declare function renderCompact(value: string): string;
declare function renderFull(value: string): string;

const enabled = true;

export const flags = { visible: true, hidden: false };
export const titles = [render('a', 'compact'), renderCompact('b'), renderFull('c')];
export const echoed = renderFull(String(enabled));
export const verdict = Boolean(0) || !enabled;
