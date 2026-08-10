import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicExamples = path.join(root, "public", "examples");
const sourceDirectories = {
  projects: path.join(root, "storage", "projects"),
  chips: path.join(root, "storage", "chips")
};

await rm(publicExamples, { recursive: true, force: true });
await mkdir(publicExamples, { recursive: true });

const manifest = { schema: "digital-logic-sim-web/examples/1", projects: [], chips: [] };
for (const [kind, sourceDirectory] of Object.entries(sourceDirectories)) {
  const targetDirectory = path.join(publicExamples, kind);
  await mkdir(targetDirectory, { recursive: true });
  for (const file of (await readdir(sourceDirectory)).filter((name) => name.endsWith(".json")).sort()) {
    const source = path.join(sourceDirectory, file);
    const target = path.join(targetDirectory, file);
    await cp(source, target);
    const raw = JSON.parse(await readFile(source, "utf8"));
    manifest[kind].push({
      file,
      name: kind === "chips" ? raw.name : raw.name,
      href: `examples/${kind}/${file}`
    });
  }
}

await writeFile(path.join(publicExamples, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
