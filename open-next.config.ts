import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Defaults: in-memory incremental cache, no R2 bucket (R2 needs a card). ponytail: add R2 if ISR is ever needed.
export default defineCloudflareConfig({});
