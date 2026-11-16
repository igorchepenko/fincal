import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releases, currentVersion } from "./releases";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("история версий", () => {
  it("верхняя запись совпадает с версией package.json", () => {
    const pkg = JSON.parse(read("../package.json"));
    expect(releases[0].version).toBe(pkg.version);
    expect(currentVersion).toBe(pkg.version);
  });

  it("верхняя запись совпадает с версией tauri.conf.json", () => {
    const conf = JSON.parse(read("../src-tauri/tauri.conf.json"));
    expect(releases[0].version).toBe(conf.version);
  });

  it("верхняя запись совпадает с версией Cargo.toml", () => {
    const m = read("../src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m);
    expect(m?.[1]).toBe(releases[0].version);
  });

  it("версии уникальны и в формате x.y.z", () => {
    const versions = releases.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
