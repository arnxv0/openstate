// Lets plain Node run the app's TypeScript modules, which import each other
// as "@/lib/...": node --import ./scripts/alias-loader.mjs <script.ts>
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
