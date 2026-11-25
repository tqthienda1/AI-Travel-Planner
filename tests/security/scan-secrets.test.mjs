import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scanner = join(project, "scripts/scan-secrets.mjs");
const fakeKey = ["sk", "fixture".repeat(6)].join("-");
const fakeGoogleKey = ["AI", "za", "fixture".repeat(6)].join("");
const fakeGroqKey = ["gsk", "fixture".repeat(6)].join("_");

function run(program, args, cwd, timeout) {
  return spawnSync(program, args, { cwd, encoding: "utf8", windowsHide: true, timeout });
}
function git(repo, args) {
  const result = run("git", args, repo);
  assert.equal(result.status, 0, `Fixture Git command failed: ${args[0]}`);
  return result.stdout;
}
function fixture(t, initialize = true) {
  const repo = mkdtempSync(join(tmpdir(), "travel-secret-test-"));
  t.after(() => {
    assert.ok(repo.startsWith(join(tmpdir(), "travel-secret-test-")));
    rmSync(repo, { recursive: true, force: true });
  });
  if (initialize) git(repo, ["init", "--quiet"]);
  return repo;
}
function put(repo, path, value) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), value);
}
function commit(repo) {
  git(repo, ["add", "--all"]);
  git(repo, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
}
function scan(repo, timeout) {
  return run(process.execPath, [scanner, repo], project, timeout);
}
function findings(result) {
  return result.stderr
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertEnvironmentInventory(root) {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const assignments = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)];
  const names = new Set(assignments.map((match) => match[1]));
  assert.equal(names.size, assignments.length, "Duplicate environment variable");
  for (const match of assignments) assert.equal(match[2].trim(), "");
  const excluded = new Set([
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "tests",
    "__tests__",
  ]);
  function visit(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (
        entry.isFile() &&
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      ) {
        const source = readFileSync(path, "utf8");
        // Literal process.env reads and configuration parameters conventionally named env.
        // Arbitrary aliases, destructuring and computed keys still require source review.
        const reads =
          /\b(?:process\s*\.\s*env|env)\s*(?:\.\s*([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;
        for (const match of source.matchAll(reads)) {
          const name = match[1] ?? match[2];
          assert.ok(names.has(name), `Missing environment variable ${name} in ${path}`);
        }
      }
    }
  }
  visit(join(root, "apps"));
  visit(join(root, "packages"));
  return names;
}

test("clean repository, empty env example, and inert binary data pass with qualified output", (t) => {
  const repo = fixture(t);
  put(repo, ".env.example", "DATABASE_URL=\nGROQ_API_KEY=\nGROQ_MODEL=\n");
  put(repo, "notes with spaces.txt", "No credential here.\n");
  put(repo, "image.bin", Buffer.from([0, 255, 1, 2]));
  commit(repo);
  const result = scan(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not proof that all secrets are absent/);
  assert.match(result.stdout, /raw bytes only/);
});

test("deleted historical secret is still detected and values never reach output", (t) => {
  const repo = fixture(t);
  put(repo, "old config.txt", fakeKey);
  commit(repo);
  rmSync(join(repo, "old config.txt"));
  put(repo, "README.md", "clean current tree");
  commit(repo);
  const result = scan(repo);
  assert.equal(result.status, 1);
  const hit = findings(result).find((item) => item.rule === "openai-key");
  assert.equal(hit.path, "old config.txt");
  assert.match(hit.source, /^[a-f0-9]{40,64}$/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(fakeKey));
});

test("ignored untracked env file is inspected", (t) => {
  const repo = fixture(t);
  put(repo, ".gitignore", ".env\n");
  commit(repo);
  put(repo, ".env", `GROQ_API_KEY=${fakeGroqKey}\n`);
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(
    findings(result).some((item) => item.path === ".env" && item.source === "working-tree"),
  );
  assert.ok(!`${result.stdout}${result.stderr}`.includes(fakeGroqKey));
});

test("non-repository fails closed without leaking Git diagnostics", (t) => {
  const result = scan(fixture(t, false));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Secret scan incomplete/);
  assert.doesNotMatch(result.stdout, /No configured secret patterns found/);
});

test("public secret env name is forbidden even when its value is blank", (t) => {
  const repo = fixture(t);
  put(repo, ".env.example", "NEXT_PUBLIC_GROQ_API_KEY=\n");
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some((item) => item.rule === "public-secret-variable"));
});

test("nonempty env example values fail even for nonsensitive configuration", (t) => {
  const repo = fixture(t);
  put(repo, ".env.example", "GROQ_MODEL=some-model\n");
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some((item) => item.rule === "env-example-value"));
});

test("example path aliases are checked across history, not only the first blob path", (t) => {
  const repo = fixture(t);
  put(repo, "config.env", "GROQ_MODEL=some-model\n");
  commit(repo);
  git(repo, ["mv", "config.env", ".env.example"]);
  commit(repo);
  rmSync(join(repo, ".env.example"));
  put(repo, "README.md", "clean");
  commit(repo);
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(
    findings(result).some(
      (item) => item.rule === "env-example-value" && item.path === ".env.example",
    ),
  );
});

test("secret on a non-current branch is inspected", (t) => {
  const repo = fixture(t);
  put(repo, "README.md", "base");
  commit(repo);
  const baseBranch = git(repo, ["branch", "--show-current"]).trim();
  git(repo, ["switch", "--quiet", "-c", "other"]);
  put(repo, "hidden.txt", fakeKey);
  commit(repo);
  git(repo, ["switch", "--quiet", baseBranch]);
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some((item) => item.path === "hidden.txt"));
});

test("database password URL, generic secret assignment and private key are detected", (t) => {
  const repo = fixture(t);
  put(
    repo,
    "config.txt",
    [
      ["postgresql://fixture", ":", "fixture-password", "@localhost/app"].join(""),
      ["SESSION_SECRET=", "fixture-value-123"].join(""),
      ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
    ].join("\n"),
  );
  const result = scan(repo);
  assert.equal(result.status, 1);
  const rules = findings(result).map((item) => item.rule);
  assert.ok(rules.includes("database-password"));
  assert.ok(rules.includes("secret-assignment"));
  assert.ok(rules.includes("private-key"));
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /fixture-password|fixture-value-123/);
});

test("generated folders are excluded from working files, but tracked history is still inspected", (t) => {
  const repo = fixture(t);
  put(repo, "node_modules/pkg/key.txt", fakeKey);
  put(repo, ".pnpm-store/pkg/key.txt", fakeKey);
  assert.equal(scan(repo).status, 0);
  commit(repo);
  assert.equal(scan(repo).status, 1);
});

test("repository gitignore ignores local env and keys but preserves .env.example", (t) => {
  const repo = fixture(t);
  put(repo, ".gitignore", readFileSync(join(project, ".gitignore")));
  for (const path of [
    ".env",
    ".env.local",
    ".env.production",
    "nested/.env.local",
    "private.pem",
    "server.key",
  ]) {
    assert.equal(run("git", ["check-ignore", "--quiet", path], repo).status, 0, path);
  }
  for (const path of [".env.example", "nested/.env.example", "README.md"]) {
    assert.equal(run("git", ["check-ignore", "--quiet", path], repo).status, 1, path);
  }
});

test("staged secret remains visible after the working copy has been cleaned", (t) => {
  const repo = fixture(t);
  put(repo, "README.md", "base");
  commit(repo);
  put(repo, "staged.env", `DATABASE_PASSWORD=${"fixture".repeat(4)}\n`);
  git(repo, ["add", "staged.env"]);
  put(repo, "staged.env", "DATABASE_PASSWORD=\n");
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(
    findings(result).some((item) => item.path === "staged.env" && item.source.startsWith("index:")),
  );
});

test("shallow history fails closed instead of claiming an entire-history scan", (t) => {
  const repo = fixture(t);
  put(repo, "README.md", "base");
  commit(repo);
  put(repo, "README.md", "second");
  commit(repo);
  put(repo, ".git/shallow", `${git(repo, ["rev-parse", "HEAD"]).trim()}\n`);
  const result = scan(repo);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /shallow/i);
});

test("quoted dotenv passwords with inline hash comments are detected", (t) => {
  const repo = fixture(t);
  put(repo, ".env", `DATABASE_PASSWORD="${"fixture".repeat(4)}" # local\n`);
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some((item) => item.rule === "secret-assignment"));
});

test("your_ prefix does not exempt an arbitrary literal password", (t) => {
  const repo = fixture(t);
  put(repo, ".env", `DATABASE_PASSWORD=${["your", "fixture".repeat(4)].join("_")}\n`);
  assert.equal(scan(repo).status, 1);
});

test("raw Groq token outside an assignment is detected and redacted", (t) => {
  const repo = fixture(t);
  put(repo, "notes.txt", `Accidentally pasted: ${fakeGroqKey}\n`);
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some((item) => item.rule === "groq-key"));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(fakeGroqKey));
});

test("quoted passwords may contain the other quote delimiter", (t) => {
  const repo = fixture(t);
  put(
    repo,
    ".env",
    [
      ['DATABASE_PASSWORD="', "can't-ignore-fixture", '" # local'].join(""),
      ["SESSION_SECRET='", 'has"double"quotes-fixture', "' # local"].join(""),
    ].join("\n"),
  );
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.equal(findings(result).filter((item) => item.rule === "secret-assignment").length, 2);
});

test("a quoted password with an escaped delimiter remains detectable", (t) => {
  const repo = fixture(t);
  put(repo, ".env", ['DATABASE_PASSWORD="', 'fixture\\"escaped-delimiter', '" # local'].join(""));
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some((item) => item.rule === "secret-assignment"));
});

test("provider token in non-UTF8 raw bytes is detected without claiming embedded extraction", (t) => {
  const repo = fixture(t);
  put(repo, "raw.bin", Buffer.concat([Buffer.from([255, 0]), Buffer.from(fakeGoogleKey)]));
  const result = scan(repo);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some((item) => item.rule === "google-api-key"));
  assert.match(result.stdout, /raw bytes only/);
});

test("malformed quoted input completes within a bounded subprocess timeout", (t) => {
  const repo = fixture(t);
  put(
    repo,
    ".env.example",
    ['DATABASE_PASSWORD="', "\\".repeat(1000), "missing closing delimiter"].join(""),
  );
  const result = scan(repo, 5000);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.ok(findings(result).some((item) => item.rule === "env-example-value"));
});

test("empty environment inventory covers existing API reads and planned Groq integration", () => {
  const names = assertEnvironmentInventory(project);
  for (const name of ["DATABASE_URL", "GROQ_API_KEY", "GROQ_MODEL", "HOST", "PORT"]) {
    assert.ok(names.has(name), `Missing required configuration variable ${name}`);
  }
});

test("environment inventory detects omitted variables in nested application modules", (t) => {
  const repo = fixture(t, false);
  put(repo, ".env.example", "HOST=\n");
  put(repo, "apps/api/src/services/weather.ts", "export const url = process.env.WEATHER_URL;\n");
  assert.throws(() => assertEnvironmentInventory(repo), /Missing environment variable WEATHER_URL/);
  put(repo, ".env.example", "HOST=\nWEATHER_URL=\n");
  assert.doesNotThrow(() => assertEnvironmentInventory(repo));
});

test("environment inventory covers shared config env parameters and literal bracket reads", (t) => {
  const repo = fixture(t, false);
  put(repo, ".env.example", "HOST=\n");
  put(
    repo,
    "packages/shared/src/config.ts",
    "export const config = (env) => env['PORT'] ?? env.HOST;\n",
  );
  assert.throws(() => assertEnvironmentInventory(repo), /Missing environment variable PORT/);
  put(repo, ".env.example", "HOST=\nPORT=\n");
  put(repo, "apps/api/src/provider.mjs", "export const model = process.env['GROQ_MODEL'];\n");
  assert.throws(() => assertEnvironmentInventory(repo), /Missing environment variable GROQ_MODEL/);
  put(repo, ".env.example", "HOST=\nPORT=\nGROQ_MODEL=\n");
  assert.doesNotThrow(() => assertEnvironmentInventory(repo));
});

test("environment inventory ignores test fixtures and generated dependencies", (t) => {
  const repo = fixture(t, false);
  put(repo, ".env.example", "HOST=\nADDITIONAL_DOCUMENTED_OPTION=\n");
  for (const path of [
    "apps/api/tests/example.ts",
    "apps/api/src/example.test.ts",
    "packages/shared/node_modules/example/index.js",
    "apps/api/dist/index.js",
  ]) {
    put(repo, path, "export const synthetic = process.env.FIXTURE_ONLY;\n");
  }
  assert.doesNotThrow(() => assertEnvironmentInventory(repo));
});
