/** Light haptic tap on supporting devices. Respects the user's haptics preference (data-haptics on <html>). */
export function haptic(pattern: number | number[] = 12) {
  if (typeof document === "undefined" || document.documentElement.dataset.haptics === "off") return;
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(pattern);
}
