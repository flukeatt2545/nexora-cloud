/** A repeatable "random" number between 0 and 1: the same index and salt always give the same one, so the server and the browser draw the same scene. */
export const seeded = (index: number, salt: number) => {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export const n = (value: number) => Math.round(value * 10) / 10;
