import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  findExactDuplicates,
  findNearDuplicates,
  findStructuralDuplicates,
} from "./duplicateLogic";

export function activate(context: vscode.ExtensionContext) {
  console.log("Duplicate Code Detector is now active!");

  // Register the main command
  const analyzeCommand = vscode.commands.registerCommand(
    "extension.analyzeDuplicates",
    async () => {
      const folder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Folder to Analyze",
      });

      if (!folder) {
        vscode.window.showErrorMessage("No folder selected!");
        return;
      }

      const folderPath = folder[0].fsPath;

      // Get all JavaScript/TypeScript/JSX/TSX files
      const fileMap: { [key: string]: string } = {};
      const files: string[] = [];

      const extensions = [".js", ".ts", ".tsx", ".jsx"];
      const readFilesRecursively = (dir: string) => {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        items.forEach((item) => {
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            readFilesRecursively(fullPath);
          } else if (extensions.some((ext) => item.name.endsWith(ext))) {
            files.push(fullPath);
            fileMap[fullPath] = fs.readFileSync(fullPath, "utf-8");
          }
        });
      };

      readFilesRecursively(folderPath);

      if (files.length === 0) {
        vscode.window.showWarningMessage(
          "No valid files found in the selected folder."
        );
        return;
      }

      vscode.window
        .showQuickPick(["Exact", "Near", "Structural"], {
          placeHolder: "Select analysis type",
        })
        .then(async (choice) => {
          if (!choice) {
            vscode.window.showWarningMessage("No analysis type selected.");
            return;
          }

          vscode.window.showInformationMessage(
            `Analyzing ${files.length} files for ${choice} duplicates...`
          );

          let results: any[] = [];
          try {
            switch (choice) {
              case "Exact":
                results = findExactDuplicates(files, fileMap);
                break;
              case "Near":
                results = await findNearDuplicates(files, fileMap, 0.8);
                break;
              case "Structural":
                results = findStructuralDuplicates(files, fileMap);
                break;
            }

            const formattedResults = JSON.stringify(results, null, 2);
            const outputChannel = vscode.window.createOutputChannel(
              "Duplicate Code Detector"
            );
            outputChannel.appendLine(`=== ${choice} Duplicates Analysis ===`);
            outputChannel.appendLine(formattedResults);
            outputChannel.show();
          } catch (error) {
            vscode.window.showErrorMessage(
              `Error analyzing duplicates: ${error}`
            );
            console.error("Error analyzing duplicates:", error);
          }
        });
    }
  );

  context.subscriptions.push(analyzeCommand);
}

export function deactivate() {
  console.log("Duplicate Code Detector has been deactivated.");
}
