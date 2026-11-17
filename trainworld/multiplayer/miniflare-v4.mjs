import { Miniflare as Runtime, convertV4MiniflareOptions } from 'miniflare';
// Keep the existing local fixtures while using the runtime matching the Worker build.
export class Miniflare extends Runtime {
  constructor(options) { super(convertV4MiniflareOptions(options)); }
}
