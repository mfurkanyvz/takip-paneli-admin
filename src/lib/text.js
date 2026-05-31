export function normalizeInstagramUsername(value = "") {
  return String(value)
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export function isValidInstagramUsername(value = "") {
  const username = normalizeInstagramUsername(value);
  if (!/^[a-z0-9._]{1,30}$/.test(username)) return false;
  if (username.startsWith(".") || username.endsWith(".")) return false;
  if (username.includes("..")) return false;
  return true;
}

export function formatFirstNames(value = "") {
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLocaleLowerCase("tr-TR");
      return `${lower.charAt(0).toLocaleUpperCase("tr-TR")}${lower.slice(1)}`;
    })
    .join(" ");
}

export function formatLastName(value = "") {
  return String(value).trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

export function passwordIssues(password = "") {
  const issues = [];
  if (password.length < 5) issues.push("En az 5 karakter olmalı.");
  if (!/[A-ZÇĞİÖŞÜ]/.test(password)) issues.push("En az bir büyük harf olmalı.");
  if (!/[a-zçğıöşü]/.test(password)) issues.push("En az bir küçük harf olmalı.");
  if (!/\d/.test(password)) issues.push("En az bir sayı olmalı.");
  if (!/[^A-Za-zÇĞİÖŞÜçğıöşü0-9]/.test(password)) issues.push("En az bir sembol olmalı.");
  return issues;
}

export function toDisplayUsername(value = "") {
  const username = normalizeInstagramUsername(value);
  return username ? `@${username}` : "";
}

export function uniqueSortedUsernames(values) {
  return [...new Set(values.map(normalizeInstagramUsername).filter(isValidInstagramUsername))]
    .sort((a, b) => a.localeCompare(b));
}
