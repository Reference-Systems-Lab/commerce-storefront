// Repository checks that no off-the-shelf linter covers, run by scripts/lint.sh:
//   node scripts/check-repo.mjs <npmrc|scripts|allow-scripts|nuxt-config|pins|pairs>
// Each prints what is wrong and exits non-zero. nuxt.config.ts is read with the TypeScript parser,
// not loaded, so the checks need no build.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));

// The hardened settings (commerce ADR 0001, DE-2) and our scope on GitHub Packages.
const NPMRC = [
  "strict-allow-scripts=true",
  "min-release-age=7",
  "allow-git=none",
  "allow-remote=none",
  "engine-strict=true",
  "@reference-systems-lab:registry=https://npm.pkg.github.com",
  "min-release-age-exclude[]=@reference-systems-lab/*",
];
const LIFECYCLE = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
  "prepack",
  "postpack",
  "prepublishOnly",
  "publish",
  "postpublish",
  "dependencies",
]);
const ROUTE_RULE_KEYS = new Set(["prerender", "noScripts", "headers", "redirect"]);
const TOKENS_CSS = "@reference-systems-lab/tokens/tokens.css";

function npmrc() {
  const lines = readFileSync(".npmrc", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const problems = [];
  for (const want of NPMRC) if (!lines.includes(want)) problems.push(`.npmrc lacks ${want}`);
  for (const line of lines) {
    if (!NPMRC.includes(line))
      problems.push(`.npmrc has an unexpected setting: ${line.split("=")[0]}`);
  }
  return problems;
}

function scripts() {
  const names = Object.keys(json("package.json").scripts ?? {});
  return names
    .filter((name) => LIFECYCLE.has(name) || /^(pre|post)/.test(name))
    .map((name) => `package.json has a lifecycle or hook script: ${name}`);
}

function allowScripts() {
  const { allowScripts = {} } = json("package.json");
  const packages = json("package-lock.json").packages;
  const withScripts = new Set(
    Object.entries(packages)
      .filter(([, entry]) => entry.hasInstallScript)
      .map(([path]) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length)),
  );
  const problems = [];
  for (const name of withScripts) {
    if (!(name in allowScripts))
      problems.push(`allowScripts doesn't name ${name}, which has an install script`);
  }
  for (const [name, allowed] of Object.entries(allowScripts)) {
    if (!withScripts.has(name))
      problems.push(`allowScripts names ${name}, which has no install script`);
    if (allowed !== false) problems.push(`allowScripts must set ${name} to false`);
  }
  return problems;
}

/** The object literal passed to defineNuxtConfig in nuxt.config.ts. */
function nuxtConfig() {
  const source = ts.createSourceFile(
    "nuxt.config.ts",
    readFileSync("nuxt.config.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let config;
  source.forEachChild(function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "defineNuxtConfig" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      config = node.arguments[0];
    } else {
      node.forEachChild(visit);
    }
  });
  return { source, config };
}

function property(object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  const found = object.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name && (p.name.text ?? p.name.getText()) === name,
  );
  return found?.initializer;
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map((file) => join(dir, String(file)));
}

function nuxtSettings() {
  const { source, config } = nuxtConfig();
  if (!config) return ["nuxt.config.ts doesn't call defineNuxtConfig with an object"];
  const problems = [];
  const text = (node) => node?.getText(source);

  if (text(property(property(config, "future"), "compatibilityVersion")) !== "5") {
    problems.push("future.compatibilityVersion must be 5 (#1 D1)");
  }
  if (text(property(property(config, "nitro"), "preset")) !== '"node-server"') {
    problems.push('nitro.preset must be "node-server" (#1 D1)');
  }
  if (property(property(config, "experimental"), "componentIslands")) {
    problems.push("experimental.componentIslands must not be set (#1 D5)");
  }
  const islands = filesUnder("app").filter((file) => /\.(server|island)\.vue$/.test(file));
  for (const file of islands) problems.push(`${file}: no server components or islands (#1 D5)`);

  const css = property(config, "css");
  const first = css && ts.isArrayLiteralExpression(css) ? css.elements[0] : undefined;
  if (!first || !ts.isStringLiteral(first) || first.text !== TOKENS_CSS) {
    problems.push(`css must start with "${TOKENS_CSS}" (REQ-024)`);
  }

  const routeRules = property(config, "routeRules");
  if (routeRules && ts.isObjectLiteralExpression(routeRules)) {
    for (const rule of routeRules.properties) {
      if (!ts.isPropertyAssignment(rule) || !ts.isObjectLiteralExpression(rule.initializer))
        continue;
      for (const key of rule.initializer.properties) {
        const name = key.name?.getText(source);
        if (!ROUTE_RULE_KEYS.has(name)) {
          problems.push(
            `routeRules ${rule.name.getText(source)} uses ${name}; only ${[...ROUTE_RULE_KEYS].join(", ")} (#1 D2, D5)`,
          );
        }
      }
    }
  }

  if (existsSync(".output/nitro.json") && json(".output/nitro.json").preset !== "node-server") {
    problems.push(".output/nitro.json doesn't name the node-server preset");
  }
  return problems;
}

/** Every action is pinned to a full commit SHA, with its version in a comment (DE-4). */
function pins() {
  const problems = [];
  for (const file of readdirSync(".github/workflows")) {
    readFileSync(join(".github/workflows", file), "utf8")
      .split("\n")
      .forEach((line, index) => {
        const use = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line);
        if (!use || use[1].startsWith("./")) return;
        if (!/@[0-9a-f]{40}$/.test(use[1]) || !/^\s+# v\d/.test(use[2])) {
          problems.push(
            `.github/workflows/${file}:${index + 1}: ${use[1]} isn't pinned to a commit SHA with "# vX.Y.Z"`,
          );
        }
      });
  }
  return problems;
}

/**
 * The pins bumped by hand agree: the stub includes the backend's fragment at the commit of the release
 * its image tag names (as the platform's releases_agree checks), and the Playwright image runs the
 * version of @playwright/test in the lockfile.
 */
function pairs() {
  const problems = [];
  const stub = readFileSync("ci/compose.stub.yaml", "utf8");
  const include = /commerce-backend\.git#([0-9a-f]{40}):compose\.platform\.yaml # (v[\d.]+)/.exec(
    stub,
  );
  const images = [
    ...readFileSync("ci/compose.backend.yaml", "utf8").matchAll(
      /commerce-backend:([\d.]+)@sha256:/g,
    ),
  ];
  if (!include)
    problems.push(
      "ci/compose.stub.yaml doesn't include the backend's fragment at a commit with its release",
    );
  else if (images.length === 0)
    problems.push("ci/compose.backend.yaml doesn't pin the backend's image");
  else {
    const [, commit, release] = include;
    for (const [, version] of images) {
      if (`v${version}` !== release)
        problems.push(`the backend image is ${version}, but the include names ${release}`);
    }
    const refs = execFileSync(
      "git",
      [
        "ls-remote",
        "https://github.com/Reference-Systems-Lab/commerce-backend.git",
        `refs/tags/${release}`,
        `refs/tags/${release}^{}`,
      ],
      { encoding: "utf8" },
    );
    const tagged = refs
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"));
    const target = (tagged.find(([, ref]) => ref.endsWith("^{}")) ?? tagged[0])?.[0];
    if (target !== commit)
      problems.push(`${release} is commit ${target ?? "missing"}, but the stub includes ${commit}`);
  }
  const browser = /playwright:v([\d.]+)-noble@sha256:/.exec(
    readFileSync("ci/compose.browser.yaml", "utf8"),
  );
  const locked = json("package-lock.json").packages["node_modules/@playwright/test"]?.version;
  if (browser?.[1] !== locked) {
    problems.push(
      `the Playwright image is ${browser?.[1] ?? "missing"}, but the lockfile has @playwright/test ${locked}`,
    );
  }
  return problems;
}

const checks = {
  npmrc,
  scripts,
  "allow-scripts": allowScripts,
  "nuxt-config": nuxtSettings,
  pins,
  pairs,
};
const check = checks[process.argv[2]];
const problems = check ? check() : [`unknown check: ${process.argv[2]}`];
for (const problem of problems) process.stderr.write(`${problem}\n`);
process.exitCode = problems.length === 0 ? 0 : 1;
