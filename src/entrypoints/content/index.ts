import { type ContentScriptContext, defineContentScript } from '#imports';
import { runContentScript } from './main';
import './content.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  async main(ctx: ContentScriptContext): Promise<void> {
    await runContentScript(ctx);
  },
});
