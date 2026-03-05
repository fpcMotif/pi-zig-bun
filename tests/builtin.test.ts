import { describe, expect, test } from "bun:test";
import { readTool, writeTool, editTool, bashTool, builtinTools } from "../src/tools/builtin";

describe("builtin tools", () => {
  test("readTool has correct basic properties", () => {
    expect(readTool.id).toBe("read");
    expect(readTool.capabilities).toEqual(["fs.read"]);
  });

  test("writeTool has correct basic properties", () => {
    expect(writeTool.id).toBe("write");
    expect(writeTool.capabilities).toEqual(["fs.write"]);
  });

  test("editTool has correct basic properties", () => {
    expect(editTool.id).toBe("edit");
    expect(editTool.capabilities).toEqual(["fs.read", "fs.write"]);
  });

  test("bashTool has correct basic properties", () => {
    expect(bashTool.id).toBe("bash");
    expect(bashTool.capabilities).toEqual(["fs.execute"]);
  });

  test("builtinTools array contains all builtin tools", () => {
    expect(builtinTools).toEqual([readTool, writeTool, editTool, bashTool]);
  });
});
