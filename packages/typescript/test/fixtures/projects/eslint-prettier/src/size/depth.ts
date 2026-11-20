export function depth(value: number): number {
  if (value > 0) {
    if (value > 1) {
      if (value > 2) {
        if (value > 3) {
          if (value > 4) {
            return 5;
          }
        }
      }
    }
  }
  return 0;
}
