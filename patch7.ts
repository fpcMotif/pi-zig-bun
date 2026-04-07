import * as fs from "node:fs";

let content = fs.readFileSync("tests/agent-providers.test.ts", "utf-8");

content = content.replace(
  `spyOn(globalThis, "fetch").mockImplementation(async (_: any, init?: any) => {`,
  `spyOn(globalThis, "fetch").mockImplementation((async (_: any, init?: any) => {`
);

content = content.replace(
  `return new Response(new ReadableStream(), { status: 200 });
    });`,
  `return new Response(new ReadableStream(), { status: 200 });
    }) as any);`
);

content = content.replace(
  `const stream = await agent.stream(sampleInput);`,
  `const stream = (await agent.stream(sampleInput))!;`
);

fs.writeFileSync("tests/agent-providers.test.ts", content);
console.log("Patched test file TS errors");
