import { test, onTestFinished } from "vite-plus/test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, cp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

const exec = promisify(execFile);
async function fixture() {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(resolve(parent, "tw-assets-"));
  if (!directory.startsWith(parent + sep)) throw new Error("Invalid fixture path");
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  async function worker(name) {
    const here = resolve(directory, name, "trainworld/multiplayer");
    await mkdir(here, { recursive: true });
    for (const file of ["prepare-assets.mjs", "retain-current-assets.mjs", "headers.txt"])
      await copyFile(new URL(file, import.meta.url), resolve(here, file));
    return here;
  }
  const run = (here, file) => exec(process.execPath, [resolve(here, file)], { cwd: here });
  return { worker, run };
}

test("a release snapshot carries only the current assets into an isolated deploy job", async () => {
  const f = await fixture(),
    build = await f.worker("build"),
    deploy = await f.worker("deploy");
  const dist = resolve(build, "../app/dist");
  await mkdir(resolve(dist, "assets"), { recursive: true });
  await writeFile(resolve(dist, "index.html"), "<html></html>");
  await writeFile(resolve(dist, "assets/current.js"), "current release");
  await mkdir(resolve(build, ".cloudflare/retained-assets"), { recursive: true });
  await writeFile(resolve(build, ".cloudflare/retained-assets/previous.js"), "previous release");
  await f.run(build, "prepare-assets.mjs");
  assert.deepEqual((await readdir(resolve(dist, "assets"))).sort(), ["current.js", "previous.js"]);
  await cp(
    resolve(build, ".cloudflare/current-assets"),
    resolve(deploy, ".cloudflare/current-assets"),
    { recursive: true },
  );
  await f.run(deploy, "retain-current-assets.mjs");
  assert.deepEqual(await readdir(resolve(deploy, ".cloudflare/retained-assets")), ["current.js"]);
  assert.equal(
    await readFile(resolve(deploy, ".cloudflare/retained-assets/current.js"), "utf8"),
    "current release",
  );
});

test("a missing current snapshot fails before deleting an existing retained release", async () => {
  const f = await fixture(),
    deploy = await f.worker("deploy");
  const retained = resolve(deploy, ".cloudflare/retained-assets");
  await mkdir(retained, { recursive: true });
  await writeFile(resolve(retained, "previous.js"), "keep this release");
  await assert.rejects(f.run(deploy, "retain-current-assets.mjs"), /ENOENT/);
  assert.equal(await readFile(resolve(retained, "previous.js"), "utf8"), "keep this release");
});
