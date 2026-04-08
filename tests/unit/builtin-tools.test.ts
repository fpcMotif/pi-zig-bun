import { describe, expect, test } from "bun:test";
import { builtinTools, readTool, writeTool, editTool, bashTool } from "../../src/tools/builtin";

describe("builtinTools", () => {
  test("contains all expected tools in order", () => {
    expect(builtinTools).toEqual([readTool, writeTool, editTool, bashTool]);
  });

  test("has the correct number of tools", () => {
    expect(builtinTools).toHaveLength(4);
  });
});
