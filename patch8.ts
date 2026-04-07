import * as fs from "node:fs";

let content = fs.readFileSync("tests/agent-providers.test.ts", "utf-8");

content = content.replace(
  `expect(events[3].type).toBe("done");`,
  `expect(events[3]!.type).toBe("done");`
);

fs.writeFileSync("tests/agent-providers.test.ts", content);
console.log("Patched array index TS error");
