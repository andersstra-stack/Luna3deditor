#!/usr/bin/env node
// Ny versjon av Luna 3D: oppdaterer package.json (som tauri.conf.json leser fra),
// src-tauri/Cargo.toml og flytter [Unreleased] i CHANGELOG.md til en ny versjonsseksjon.
//
//   npm run bump -- patch | minor | major | 1.2.3
//
// Skriptet committer og tagger ikke – det skriver ut kommandoene til slutt.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const write = (p, s) => writeFileSync(new URL(p, root), s);

const pkg = JSON.parse(read("package.json"));
const arg = process.argv[2];
if (!arg) {
  console.error("Bruk: npm run bump -- patch | minor | major | <versjon>");
  process.exit(1);
}

const [maj, min, pat] = pkg.version.split(".").map(Number);
const next =
  arg === "major" ? `${maj + 1}.0.0` : arg === "minor" ? `${maj}.${min + 1}.0` : arg === "patch" ? `${maj}.${min}.${pat + 1}` : arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Ugyldig versjon: ${next}`);
  process.exit(1);
}

pkg.version = next;
write("package.json", JSON.stringify(pkg, null, 2) + "\n");

const cargo = read("src-tauri/Cargo.toml");
write("src-tauri/Cargo.toml", cargo.replace(/^version = ".*"$/m, `version = "${next}"`));

const date = new Date().toISOString().slice(0, 10);
const changelog = read("CHANGELOG.md");
if (!changelog.includes("## [Unreleased]")) {
  console.error("Fant ikke «## [Unreleased]» i CHANGELOG.md");
  process.exit(1);
}
write("CHANGELOG.md", changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${next}] — ${date}`));

console.log(`Luna 3D er nå v${next}. Neste steg:
  git commit -am "Luna 3D v${next}"
  git tag v${next}
  git push && git push --tags`);
