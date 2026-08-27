export function readArg(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

export function requireArg(name: string): string {
  const value = readArg(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}
