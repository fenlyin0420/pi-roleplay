import { writeFileSync, mkdirSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const dir = "/tmp/rp-spike/dump";
  mkdirSync(dir, { recursive: true });
  let n = 0;
  pi.on("before_provider_request", async (event) => {
    n++;
    writeFileSync(`${dir}/payload-${n}.json`, JSON.stringify(event.payload, null, 2));
  });
}
