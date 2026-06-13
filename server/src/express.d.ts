// Augment Express Request with auth context populated by requireAuth.
import type { SupabaseClient } from '@supabase/supabase-js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
      token?: string;
      db?: SupabaseClient;
    }
  }
}

export {};
