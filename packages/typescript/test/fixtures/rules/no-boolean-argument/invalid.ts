declare function render(value: string, compact: boolean): string;
declare const panel: { open(animated: boolean): void };
declare class Widget {
  constructor(visible: boolean);
}

render('title', true);
panel.open(false);
new Widget(true);
panel?.open(true);
render(String(false), false);
