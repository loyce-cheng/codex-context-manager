// Disposable local model for an isolated desktop experiment. Never reuse an existing config.
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startCompactionFixture} from '../../scripts/compaction-provider-fixture.mjs';

const home=process.argv[2];
const fixture=await startCompactionFixture();
try {
  await writeFile(join(home,'config.toml'),[
    'model = "gpt-6-astra"', 'model_provider = "context_lens_probe"',
    '[analytics]', 'enabled = false',
    '[model_providers.context_lens_probe]', 'name = "Context Lens local fixture"',
    'base_url = '+JSON.stringify(fixture.url),'wire_api = "responses"',
    'requires_openai_auth = false','request_max_retries = 0','stream_max_retries = 0'
  ].join('\n')+'\n',{flag:'wx'});
  // Bound the fixture's life even if the desktop probe is interrupted.
  await new Promise(done=>{const timer=setTimeout(done,600000);timer.unref();});
} finally {
  await fixture.close();
}
