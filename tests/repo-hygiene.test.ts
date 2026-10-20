import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", "dist", "coverage", ".git", "local"]);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe("repository hygiene", () => {
  it("ships .env.example but no real .env file", () => {
    expect(existsSync(join(root, ".env.example"))).toBe(true);
    expect(existsSync(join(root, ".env"))).toBe(false);
  });

  it("has only placeholder values in .env.example", () => {
    const text = readFileSync(join(root, ".env.example"), "utf8");
    const keyLines = text.split("\n").filter((l) => /^[A-Z_]*(KEY|SECRET|TOKEN)[A-Z_]*=/.test(l));
    for (const line of keyLines) expect(line).toMatch(/=(replace-me)?$/);
  });

  it("contains no secret-looking strings in source files", () => {
    const patterns = [
      /AIza[0-9A-Za-z_-]{30,}/,
      /AQ\.[0-9A-Za-z_-]{30,}/,
      /sk-[A-Za-z0-9]{20,}/,
      /sk-ant-[A-Za-z0-9_-]{20,}/,
      /ghp_[A-Za-z0-9]{30,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (!/\.(ts|tsx|mjs|js|json|md|yml|yaml|sql|css|env|example)$/.test(file) || file.endsWith("package-lock.json")) continue;
      if (file.endsWith("repo-hygiene.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      if (patterns.some((p) => p.test(text))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("does not commit database or build artifacts", () => {
    const bad = [...walk(root)].filter((f) => /\.(db|sqlite3?)$/.test(f));
    expect(bad).toEqual([]);
  });

  it("keeps core free of framework and server-only imports", () => {
    const forbidden = /from ["'](react|react-dom|next|next\/[^"']*|express|@modelcontextprotocol\/[^"']*|node:[^"']*)["']/;
    const offenders = [...walk(join(root, "packages", "core", "src"))].filter((f) => forbidden.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("sample notes are original and labelled", () => {
    for (const f of readdirSync(join(root, "data", "sample-notes"))) {
      const text = readFileSync(join(root, "data", "sample-notes", f), "utf8");
      expect(text).toMatch(/^---\n[\s\S]*origin: sample[\s\S]*?---/);
    }
  });

  it("git-tracked list excludes node_modules when inside a git repo", () => {
    try {
      const out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      expect(out).not.toMatch(/node_modules\//);
    } catch {
      /* not a git checkout (e.g. extracted ZIP): nothing to check */
    }
  });
});
