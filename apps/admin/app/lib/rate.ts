/** a থেকে b-তে কত শতাংশ গেল, এক দশমিক পর্যন্ত (০ দিয়ে ভাগ হলে ০) */
export function rate(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}
