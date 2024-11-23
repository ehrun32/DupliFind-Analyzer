import generate from "@babel/generator";
import { parse } from "@babel/parser";
import * as crypto from "crypto";
import { compareTwoStrings } from "string-similarity";

// Utility: Hash function
function hashCode(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// Utility: Extract functions from code
export function extractFunctions(ast: any): string[] {
  const functions: string[] = [];

  function traverse(node: any) {
    if (!node) return;

    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      functions.push(nodeToString(node)); // Convert function to string
    }

    Object.keys(node).forEach((key) => {
      if (typeof node[key] === "object") traverse(node[key]);
    });
  }

  traverse(ast);
  return functions;
}

// Convert AST node to string
export function nodeToString(node: any): string {
  return generate(node, { comments: false }).code; // Strip comments
}

// Utility: Normalize AST
function normalizeAST(node: any): string {
  try {
    const clonedNode = JSON.parse(JSON.stringify(node));
    traverse(clonedNode);
    return generate(clonedNode, { comments: false }).code;

    function traverse(n: any) {
      if (!n || typeof n !== "object") return;

      try {
        // Replace identifiers and literals with placeholders
        if (n.type === "Identifier") {
          n.name = "placeholder";
        } else if (n.type === "Literal" || n.type === "StringLiteral") {
          n.value = "placeholder";
        } else if (n.type === "TemplateLiteral" && n.quasis) {
          n.quasis.forEach((quasi: any) => {
            quasi.value.raw = "placeholder";
            quasi.value.cooked = "placeholder";
          });
          n.expressions.forEach(traverse);
        } else if (n.type === "BinaryExpression") {
          traverse(n.left);
          traverse(n.right);
        } else if (n.type === "CallExpression") {
          traverse(n.callee);
          n.arguments.forEach(traverse);
        } else if (n.type === "ReturnStatement") {
          traverse(n.argument);
        } else if (n.type === "IfStatement") {
          traverse(n.test);
          traverse(n.consequent);
          if (n.alternate) traverse(n.alternate);
        }

        // Recursively traverse child nodes for other types
        Object.keys(n).forEach((key) => {
          if (typeof n[key] === "object") traverse(n[key]);
        });
      } catch (error) {
        console.error(`Error traversing node of type ${n.type}:`, error);
      }
    }
  } catch (error) {
    console.error("Error normalizing AST node:", error);
    return ""; // Skip the node
  }
}

// **Exact Duplicate Detection**
export function findExactDuplicates(
  files: string[],
  fileMap: { [key: string]: string }
) {
  const hashes: { [hash: string]: { code: string; files: string[] } } = {};

  files.forEach((file) => {
    const code = fileMap[file];
    const ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });

    extractFunctions(ast).forEach((func) => {
      const funcCode = func.trim();
      const hash = hashCode(funcCode);

      if (!hashes[hash]) {
        hashes[hash] = { code: funcCode, files: [] };
      }
      if (!hashes[hash].files.includes(file)) {
        hashes[hash].files.push(file);
      }
    });
  });

  // Filter out hashes with only one occurrence (not duplicates)
  return Object.values(hashes)
    .filter((entry) => entry.files.length > 1)
    .map((entry) => ({ function: entry.code, files: entry.files }));
}

// **Near Duplicate Detection**
export async function findNearDuplicates(
  files: string[],
  fileMap: { [key: string]: string },
  threshold: number = 0.8
) {
  const functions: { code: string; file: string }[] = [];

  // Extract all functions from all files
  files.forEach((file) => {
    const code = fileMap[file];
    const ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    extractFunctions(ast).forEach((func) => {
      functions.push({ code: func.trim(), file });
    });
  });

  // Group functions by size to optimize comparison
  const grouped = groupFunctionsBySize(functions);

  const results: any[] = [];
  const seenPairs: Set<string> = new Set();

  // Compare functions within each group
  Array.from(grouped.values()).forEach((group) => {
    for (let i = 0; i < group.length; i++) {
      const matches: {
        function: string;
        similarity: number;
        files: string[];
      }[] = [];

      for (let j = 0; j < group.length; j++) {
        if (i !== j) {
          const sim = compareTwoStrings(group[i].code, group[j].code);
          if (sim >= threshold) {
            // Ensure unique pairs using a canonical key
            const pairKey =
              [group[i].file, group[j].file].sort().join(":") +
              ":" +
              group[i].code;

            if (!seenPairs.has(pairKey)) {
              matches.push({
                function: group[j].code,
                similarity: sim,
                files: [group[j].file],
              });
              seenPairs.add(pairKey);
            }
          }
        }
      }

      if (matches.length > 0) {
        results.push({
          function: group[i].code,
          file: group[i].file,
          matches,
        });
      }
    }
  });

  return results;
}

// Group functions by size
function groupFunctionsBySize(
  functions: { code: string; file: string }[]
): Map<number, { code: string; file: string }[]> {
  const grouped = new Map<number, { code: string; file: string }[]>();
  functions.forEach((func) => {
    const size = func.code.length;
    const bucket = Math.floor(size / 100);
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket)!.push(func);
  });
  return grouped;
}

// **Structural Duplicate Detection**
export function findStructuralDuplicates(
  files: string[],
  fileMap: { [key: string]: string }
): {
  normalizedFunction: string;
  originalFunctions: { file: string; function: string }[];
}[] {
  const normalizedHashes: {
    [hash: string]: {
      normalizedFunction: string;
      originalFunctions: { file: string; function: string }[];
    };
  } = {};

  files.forEach((file) => {
    const code = fileMap[file];
    const ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    const functions = extractFunctions(ast);

    functions.forEach((originalFunction) => {
      try {
        // Try parsing and normalizing the function
        const normalizedCode = normalizeAST(
          parse(originalFunction, {
            sourceType: "module",
            plugins: ["typescript", "jsx"],
          })
        );

        if (!normalizedCode) {
          console.warn(`Skipping unprocessable function in file: ${file}`);
          return;
        }

        const hash = hashCode(normalizedCode);

        if (!normalizedHashes[hash]) {
          normalizedHashes[hash] = {
            normalizedFunction: normalizedCode,
            originalFunctions: [],
          };
        }
        normalizedHashes[hash].originalFunctions.push({
          file,
          function: originalFunction,
        });
      } catch (error) {
        // Log and skip invalid syntax or parsing errors
        console.error(`Error processing function in file: ${file}`, error);
      }
    });
  });

  // Filter results to include only structural duplicates (more than one occurrence)
  return Object.values(normalizedHashes).filter(
    (entry) => entry.originalFunctions.length > 1
  );
}
