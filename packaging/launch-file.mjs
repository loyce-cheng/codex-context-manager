import { launchFile } from '../plugins/context-lens/src/server/file.mjs';
try { await launchFile(); } catch(error) { process.stderr.write(error.message+'\n');process.exitCode=1; }
