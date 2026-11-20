declare function toggle(flag: boolean): void;
declare function setEnabled(flag: boolean): void;
declare const panel: { setVisible(flag: boolean): void; set(flag: boolean): void };

toggle(true);
setEnabled(false);
panel.setVisible(true);
panel.set(false);
