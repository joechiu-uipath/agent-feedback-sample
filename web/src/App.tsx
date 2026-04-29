import { useEffect, useRef, useState } from 'react';
import { UiPath } from '@uipath/uipath-typescript/core';
import { ConversationalAgent, Exchanges, FeedbackRating } from '@uipath/uipath-typescript/conversational-agent';
import { APP_CONFIG } from './config';
import { Booth } from './Booth';

function getRedirectUri() {
  return window.location.href.split('?')[0].split('#')[0].replace(/\/$/, '');
}

export function App() {
  const [status, setStatus] = useState<'idle' | 'initializing' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sdkRef = useRef<UiPath | null>(null);
  const agentServiceRef = useRef<ConversationalAgent | null>(null);
  const exchangesServiceRef = useRef<Exchanges | null>(null);

  // Only auto-finish auth if we're on the callback (code= present). Otherwise wait for user click.
  useEffect(() => {
    const hasCode = new URL(window.location.href).searchParams.has('code');
    if (hasCode) {
      void signIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn() {
    setStatus('initializing');
    setErrorMessage(null);
    try {
      const sdk = new UiPath({
        baseUrl: APP_CONFIG.baseUrl,
        orgName: APP_CONFIG.orgName,
        tenantName: APP_CONFIG.tenantName,
        clientId: APP_CONFIG.clientId,
        redirectUri: getRedirectUri(),
        scope: APP_CONFIG.scope,
      });
      await sdk.initialize();

      // Clean OAuth params from URL if present.
      const url = new URL(window.location.href);
      if (url.searchParams.has('code') || url.searchParams.has('state')) {
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        url.searchParams.delete('session_state');
        url.searchParams.delete('iss');
        window.history.replaceState({}, '', url.toString());
      }

      if (!sdk.isAuthenticated()) {
        // initialize() will have redirected; this branch shouldn't hit.
        return;
      }

      sdkRef.current = sdk;
      agentServiceRef.current = new ConversationalAgent(sdk);
      exchangesServiceRef.current = new Exchanges(sdk);
      setStatus('ready');
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  function signOut() {
    try {
      (sdkRef.current as any)?.signOut?.();
    } catch {
      /* ignore */
    }
    sdkRef.current = null;
    agentServiceRef.current = null;
    exchangesServiceRef.current = null;
    setStatus('idle');
  }

  if (status === 'ready' && agentServiceRef.current && exchangesServiceRef.current) {
    return (
      <Booth
        agentService={agentServiceRef.current}
        exchangesService={exchangesServiceRef.current}
        feedbackRating={FeedbackRating}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="landing">
      <div className="landing-card">
        <div className="emblem">⚓</div>
        <h1>OpenArrrI Recruiting Booth</h1>
        <p className="tagline">
          "Step aboard, matey — we be hirin' the finest AI crew in the seven seas."
        </p>
        <button
          className="btn-primary"
          onClick={signIn}
          disabled={status === 'initializing'}
        >
          {status === 'initializing' ? 'Hoistin\' the sails…' : 'Sign in to enter the booth'}
        </button>
        {errorMessage && (
          <div className="error-banner" style={{ marginTop: '1.25rem' }}>
            {errorMessage}
          </div>
        )}
        <div className="landing-meta">
          Secured by UiPath External Applications (PKCE)
        </div>
      </div>
    </div>
  );
}
