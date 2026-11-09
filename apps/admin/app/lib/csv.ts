/**
 * ছোট CSV পার্সার (RFC 4180): কমা, উদ্ধৃতি চিহ্নের ভেতরে কমা বা নতুন লাইন, "" মানে একটা ".
 * প্রথম লাইন হেডার; প্রতিটি সারি হেডারের নাম (ছোট হাতের, ফাঁকা জায়গা বাদ) দিয়ে object হয়।
 */
export function parseCsv(text: string, maxRows = Infinity): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      if (rows.length > maxRows) break;
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);

  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  return body.slice(0, maxRows).map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((key, i) => {
      if (key) record[key] = (cells[i] ?? "").trim();
    });
    return record;
  });
}
