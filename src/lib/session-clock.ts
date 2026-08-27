export function formatCountdown(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalSec = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
