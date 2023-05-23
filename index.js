const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const util = require("util");

const ts = require("typescript");

const execAsync = util.promisify(exec);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

// 默认路径为 'app/utils'，如果提供了命令行参数，则使用第一个参数作为路径
const targetDir = process.argv[2]
  ? path.join(process.cwd(), process.argv[2])
  : path.join(process.cwd(), "app", "utils");

const runTsPrune = async () => {
  console.log("🔍 Analyzing...");
  const { stdout } = await execAsync(`npx ts-prune -p ./tsconfig.json`);
  return stdout;
};

const removeUnusedExports = async (unusedExports) => {
  const unusedExportsSet = new Set(
    unusedExports.map((exportLine) => {
      const [, , exportName] = exportLine.match(/^(.*):\d+ - (.*)$/);
      return exportName;
    })
  );

  const files = fs.readdirSync(targetDir);

  console.log(
    `⏳ Removing ${unusedExportsSet.size} unused exports from ${files.length} files...`
  );

  await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(targetDir, file);
      const fileStats = fs.statSync(filePath);

      if (!fileStats.isFile()) {
        return;
      }

      const fileContent = await readFile(filePath, "utf-8");
      const sourceFile = ts.createSourceFile(
        filePath,
        fileContent,
        ts.ScriptTarget.Latest,
        true
      );

      const removals = [];

      ts.forEachChild(sourceFile, (node) => {
        if (ts.isExportDeclaration(node) || ts.isVariableStatement(node)) {
          const exportName = node.getText().match(/export const (\w+)/);
          if (exportName && unusedExportsSet.has(exportName[1])) {
            removals.push({
              start: node.getFullStart(),
              end: node.getEnd(),
            });
          }
        }
      });

      if (removals.length > 0) {
        let output = "";
        let cursor = 0;

        for (const removal of removals) {
          output += fileContent.slice(cursor, removal.start);
          cursor = removal.end;
        }
        output += fileContent.slice(cursor);

        await writeFile(filePath, output);
      }
    })
  );

  console.log("🎉 DONE");
};

runTsPrune()
  .then((output) => {
    const unusedExports = output
      .split("\n")
      .filter((line) => line.startsWith(targetDir));

    return unusedExports;
  })
  .then(removeUnusedExports)
  .catch((error) => console.error("An error occurred:", error));
