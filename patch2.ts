import * as fs from "node:fs";

let content = fs.readFileSync("src/agent/providers.ts", "utf-8");

content = content.replace("abstract class BaseSseAgent", "export abstract class BaseSseAgent");

fs.writeFileSync("src/agent/providers.ts", content);
console.log("Successfully exported BaseSseAgent");
