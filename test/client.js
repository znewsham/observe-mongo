import esbuild from "esbuild";
import path from "path";
import { describe, it } from "node:test";

describe("client", () => {
  it("Should build a client bundle", async () => {
    // this test will fail if we start loading node specific code in something that will be ran from the browser
    await esbuild.build({
      absWorkingDir: path.dirname(import.meta.url.replace("file:///", "/")),
      platform: "browser",
      entryPoints: ["../lib/index.js"],
      bundle: true,
      outfile: "/dev/null"
    });
  });
});
