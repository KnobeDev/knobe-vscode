// Launches a real VS Code with this extension loaded and runs suite/index.cjs.
// Uses a local VS Code when one is found (VSCODE_EXECUTABLE or the standard
// Linux install), so the test itself needs no network.
import { runTests } from "@vscode/test-electron";
import { cpSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workspace = mkdtempSync(join(tmpdir(), "knobe-verify-it-"));
cpSync(join(root, "test", "fixtures", "vectors"), join(workspace, "vectors"), { recursive: true });
mkdirSync(join(workspace, ".vscode"));
// Keep save from rewriting sealed bytes behind the test's back.
writeFileSync(join(workspace, ".vscode", "settings.json"), JSON.stringify({
  "files.insertFinalNewline": false, "files.trimTrailingWhitespace": false, "editor.formatOnSave": false,
}));

const candidates = [process.env.VSCODE_EXECUTABLE, "/usr/share/code/code"].filter(Boolean);
const vscodeExecutablePath = candidates.find((p) => existsSync(p));

try {
  await runTests({
    ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "test", "integration", "suite", "index.cjs"),
    launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes",
      "--disable-workspace-trust", "--user-data-dir", join(workspace, ".user-data")],
    extensionTestsEnv: { KNOBE_IT_WORKSPACE: workspace },
  });
} catch (e) {
  console.error("Integration tests failed:", e);
  process.exit(1);
}
