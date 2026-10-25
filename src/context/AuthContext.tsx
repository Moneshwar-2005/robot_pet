import React, { useEffect, useState, useMemo, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { AuthContext } from './authContextDef';
import type { User, Session } from '@supabase/supabase-js';
import type { AuthContextType } from './authContextDef';

const isClientConfigured = Boolean(isSupabaseConfigured && supabase);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(isClientConfigured);
  const activeSequenceRef = useRef<number>(0);

  useEffect(() => {
    if (!isClientConfigured || !supabase) {
      return;
    }

    let isMounted = true;
    const currentSequence = ++activeSequenceRef.current;

    // 1. Restore existing session on mount
    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession }, error }) => {
        if (!isMounted || currentSequence !== activeSequenceRef.current) return;
        if (error) {
          setSession(null);
          setUser(null);
        } else {
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!isMounted || currentSequence !== activeSequenceRef.current) return;
        setSession(null);
        setUser(null);
        setLoading(false);
      });

    // 2. Subscribe to auth state changes (sign in, sign out, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!isMounted) return;
      activeSequenceRef.current++;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!isClientConfigured || !supabase) {
      return { error: new Error('Supabase client is not configured.') };
    }
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      return { error };
    } catch (err) {
      return {
        error: err instanceof Error ? err : new Error('An unexpected error occurred during sign in.'),
      };
    }
  };

  const signUp = async (email: string, password: string) => {
    if (!isClientConfigured || !supabase) {
      return {
        error: new Error('Supabase client is not configured.'),
        emailConfirmationRequired: false,
      };
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) {
        return { error, emailConfirmationRequired: false };
      }

      // If user was created but session is null, email confirmation is active in Supabase project
      const emailConfirmationRequired = Boolean(data.user && !data.session);

      return { error: null, emailConfirmationRequired };
    } catch (err) {
      return {
        error: err instanceof Error ? err : new Error('An unexpected error occurred during sign up.'),
        emailConfirmationRequired: false,
      };
    }
  };

  const signOut = async () => {
    if (!isClientConfigured || !supabase) {
      setSession(null);
      setUser(null);
      return { error: null };
    }
    try {
      const { error } = await supabase.auth.signOut();
      return { error };
    } catch (err) {
      return {
        error: err instanceof Error ? err : new Error('An unexpected error occurred during sign out.'),
      };
    }
  };

  const contextValue = useMemo<AuthContextType>(
    () => ({
      user,
      session,
      loading,
      isConfigured: isSupabaseConfigured,
      signIn,
      signUp,
      signOut,
    }),
    [user, session, loading]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export type { AuthContextType };
