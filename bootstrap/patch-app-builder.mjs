// Patch electron-builder's node-module collector (v26) for the locked-down env.
// It spawns `powershell.exe -EncodedCommand` to run `npm list`; powershell.exe
// and cmd.exe are blocked here (ENOENT/EPERM), so the packaging build fails.
// Make it run npm/npx via node directly instead. Only needed when building the
// distributable .exe (electron-builder); harmless otherwise. Idempotent.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const fp = 'node_modules/app-builder-lib/out/node-module-collector/nodeModulesCollector.js'
if (!existsSync(fp)) {
  console.log('[patch-app-builder] file not found (electron-builder not installed) — skip')
  process.exit(0)
}
let src = readFileSync(fp, 'utf8')
const MARK = 'PATCH (locked-down env'
if (src.includes(MARK)) {
  console.log('[patch-app-builder] already patched')
  process.exit(0)
}
const ORIG =
  'const [spawnCommand, spawnArgs] = process.platform === "win32" ? ["powershell.exe", buildPowerShellEncodedArgs(command, args)] : [command, args];'
const REPL = `// ${MARK}: powershell.exe and cmd.exe are blocked → ENOENT/EPERM.
        // Run npm/npx directly through node, bypassing the .cmd shim and powershell wrapper.
        let spawnCommand;
        let spawnArgs;
        if (process.platform === "win32") {
            if (execName === "npm" || execName === "npx") {
                const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", execName + "-cli.js");
                spawnCommand = process.execPath;
                spawnArgs = [npmCli, ...args];
            }
            else {
                spawnCommand = "powershell.exe";
                spawnArgs = buildPowerShellEncodedArgs(command, args);
            }
        }
        else {
            spawnCommand = command;
            spawnArgs = args;
        }`
if (!src.includes(ORIG)) {
  console.log('[patch-app-builder] target not found (electron-builder version changed?) — skip')
  process.exit(0)
}
src = src.replace(ORIG, REPL)
writeFileSync(fp, src)
console.log('[patch-app-builder] patched')
