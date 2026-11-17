import { NextRequest } from 'next/server';
import { startAuth } from '../../start-auth';

export function GET(request: NextRequest) {
  return startAuth('link', request.headers.get('cookie') ?? undefined);
}
