import { startAuth } from '../start-auth';

export function GET() {
  return startAuth('signup');
}
