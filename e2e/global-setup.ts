import { execSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default function globalSetup(): void {
  const extensionDist = path.join(root, 'extension/dist');
  if (!existsSync(path.join(extensionDist, 'manifest.json'))) {
    execSync('npm run build', { cwd: path.join(root, 'extension'), stdio: 'inherit' });
  }
}
