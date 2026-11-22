// Loaded by `node --import ./tests/hooks.mjs --test ...`. Next resolves these at build time; plain Node does not:
//  - "@/lib/x"      -> src/lib/x.ts (tsconfig paths)
//  - "./domain"     -> ./domain.ts  (extensionless imports between source files)
//  - "next/server"  -> next/server.js
//  - "server-only"  -> nothing (the real package throws outside a React Server build)
import { registerHooks } from "node:module";

const SRC = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    const wanted = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
    try {
      return nextResolve(wanted, context);
    } catch (first) {
      for (const ext of [".ts", ".js"]) {
        try {
          return nextResolve(wanted + ext, context);
        } catch {}
      }
      throw first;
    }
  },
});
